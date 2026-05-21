#include <furi.h>
#include <gui/gui.h>
#include <gui/view_dispatcher.h>
#include <gui/modules/widget.h>
#include <gui/modules/popup.h>
#include <gui/modules/dialog_ex.h>
#include <gui/modules/submenu.h>
#include <gui/modules/file_browser.h>
#include <gui/modules/variable_item_list.h>
#include <input/input.h>
#include <storage/storage.h>
#include <toolbox/stream/buffered_file_stream.h>
#include <notification/notification.h>
#include <notification/notification_messages.h>
#include <dialogs/dialogs.h>

#include <nfc/nfc.h>
#include <nfc/nfc_scanner.h>
#include <nfc/protocols/nfc_protocol.h>
#include <nfc/protocols/mf_ultralight/mf_ultralight.h>
#include <nfc/protocols/mf_ultralight/mf_ultralight_poller_sync.h>

#define APP_TAG "BatchNDEF"
#define URLS_PATH APP_DATA_PATH("urls.txt")  // resolves to /ext/apps_data/batch_ndef_writer/urls.txt
#define MAX_URLS 512
#define NDEF_START_PAGE 4

// Number of delay steps: 0ms to 3000ms in steps of 100ms (31 values: 0..30)
#define DELAY_STEP_COUNT 31
#define DELAY_STEP_MS    100
#define DELAY_DEFAULT_MS 1000

typedef enum {
    ViewIdMenu = 0,       // Submenu — main menu
    ViewIdFileBrowser,    // FileBrowser — file picker
    ViewIdSettings,       // VariableItemList — delay config
    ViewIdConfirm,        // Widget — confirm writing
    ViewIdPolling,        // Popup — waiting for tag
    ViewIdResult,         // DialogEx — error or done screen
} ViewId;

typedef enum {
    EvtCustomStart = 100,
    EvtCustomSkip,
    EvtCustomRetry,
    EvtCustomAbort,
    EvtCustomTagOk,
    EvtCustomTagFail,
    EvtCustomMenuStart,    // "Start" selected in main menu
    EvtCustomMenuFile,     // "Select File" selected in main menu
    EvtCustomMenuSettings, // "Settings" selected in main menu
    EvtCustomFilePicked,   // file selected in file browser
    EvtCustomGoMenu,       // return to main menu (used after "All done" screen)
} CustomEvent;

typedef struct {
    Gui* gui;
    ViewDispatcher* view_dispatcher;
    Widget* w_confirm;
    Popup* p_polling;
    DialogEx* d_result;
    NotificationApp* notifications;

    // New GUI modules
    Submenu* menu;
    FileBrowser* file_browser;
    FuriString* browser_result;   // output buffer for FileBrowser selected path
    VariableItemList* settings_list;
    VariableItem* delay_item;     // pointer to the delay setting item

    char** urls;
    size_t url_count;
    size_t url_index;

    Nfc* nfc;
    NfcScanner* scanner;
    FuriThread* worker;
    volatile bool tag_present;
    volatile bool stop_request;
    volatile MfUltralightError last_err;
    char last_msg[64];    // written before volatile tag_present; DMB in scanner_cb ensures ordering
    char popup_hdr[40];   // persistent storage for popup header string (popup holds pointer)
    char url_preview[64]; // persistent storage for URL preview on polling screen (popup holds pointer)

    // New settings and state
    uint32_t delay_ms;          // delay between tags in ms (default 1000)
    bool lock_after_write;      // if true, lock tag after writing NDEF (irreversible)
    char selected_path[256];    // currently selected urls.txt path
    bool at_menu;               // true when main menu is the active view
    bool show_done;             // true when showing "All done" in result dialog
    bool browser_running;       // true while FileBrowser is active (guards file_browser_stop calls)
} App;

static bool load_urls_from_path(App* app, const char* path) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    Stream* s = buffered_file_stream_alloc(storage);
    bool ok = buffered_file_stream_open(s, path, FSAM_READ, FSOM_OPEN_EXISTING);
    if(!ok) goto done;

    app->urls = malloc(sizeof(char*) * MAX_URLS);
    app->url_count = 0;
    FuriString* line = furi_string_alloc();
    while(stream_read_line(s, line) && app->url_count < MAX_URLS) {
        furi_string_trim(line);
        if(furi_string_size(line) == 0) continue;
        const char* c = furi_string_get_cstr(line);
        if(c[0] == '#') continue;
        app->urls[app->url_count++] = strdup(c);
    }
    furi_string_free(line);
done:
    buffered_file_stream_close(s);
    stream_free(s);
    furi_record_close(RECORD_STORAGE);
    return app->url_count > 0;
}

static void free_urls(App* app) {
    if(!app->urls) return;
    for(size_t i = 0; i < app->url_count; i++) free(app->urls[i]);
    free(app->urls);
    app->urls = NULL;
    app->url_count = 0;
    app->url_index = 0;
}

static uint8_t pick_prefix(const char* url, const char** rest) {
    static const struct {
        const char* p;
        uint8_t code;
    } table[] = {
        {"https://www.", 0x02},
        {"http://www.", 0x01},
        {"https://", 0x04},
        {"http://", 0x03},
        {"tel:", 0x05},
        {"mailto:", 0x06},
    };
    for(size_t i = 0; i < sizeof(table) / sizeof(table[0]); i++) {
        size_t n = strlen(table[i].p);
        if(strncmp(url, table[i].p, n) == 0) {
            *rest = url + n;
            return table[i].code;
        }
    }
    *rest = url;
    return 0x00;
}

static size_t build_ndef(const char* url, uint8_t* out, size_t out_cap) {
    const char* rest;
    uint8_t prefix = pick_prefix(url, &rest);
    size_t uri_len = strlen(rest);
    size_t payload_len = 1 + uri_len;
    if(payload_len > 0xFF) return 0;
    size_t ndef_len = 4 + payload_len;
    size_t total = (ndef_len < 0xFF ? 2 : 4) + ndef_len + 1;
    if(total > out_cap) return 0;

    size_t i = 0;
    out[i++] = 0x03;
    if(ndef_len < 0xFF) {
        out[i++] = (uint8_t)ndef_len;
    } else {
        out[i++] = 0xFF;
        out[i++] = (ndef_len >> 8) & 0xFF;
        out[i++] = ndef_len & 0xFF;
    }
    out[i++] = 0xD1;
    out[i++] = 0x01;
    out[i++] = (uint8_t)payload_len;
    out[i++] = 0x55;
    out[i++] = prefix;
    memcpy(&out[i], rest, uri_len);
    i += uri_len;
    out[i++] = 0xFE;
    return i;
}

static void scanner_cb(NfcScannerEvent event, void* ctx) {
    App* app = ctx;
    if(event.type == NfcScannerEventTypeDetected) {
        for(size_t i = 0; i < event.data.protocol_num; i++) {
            if(event.data.protocols[i] == NfcProtocolMfUltralight) {
                app->tag_present = true;
                return;
            }
        }
        snprintf(app->last_msg, sizeof(app->last_msg), "Not an NTAG/MFUL tag");
        app->last_err = MfUltralightErrorProtocol;  // set error first
        __DMB();                                      // memory barrier: ensure last_msg and last_err are visible before tag_present
        app->tag_present = true;                      // then signal worker
    }
}

// Permanently lock an NTAG21x tag — IRREVERSIBLE.
// Applies static lock bytes (page 2, bytes 2-3) and dynamic lock bytes (page 40 for NTAG213).
// Returns true if static locking succeeded (dynamic lock failure is non-fatal).
static bool lock_tag(App* app) {
    // Step 1: Read current page 2 (bytes 0-1 hold UID bytes 4-6; must be preserved)
    MfUltralightPage page2;
    MfUltralightError err = mf_ultralight_poller_sync_read_page(app->nfc, 2, &page2);
    if(err != MfUltralightErrorNone) {
        return false;
    }
    // Step 2: Set static lock bits (bytes 2-3 = 0xFF 0xFF) — permanently write-protects pages 3-15
    page2.data[2] = 0xFF;
    page2.data[3] = 0xFF;
    err = mf_ultralight_poller_sync_write_page(app->nfc, 2, &page2);
    if(err != MfUltralightErrorNone) {
        return false;
    }
    // Step 3: Write dynamic lock bytes — page 40 for NTAG213 (byte 3 = RFUI, must be 0)
    // For NTAG215/216 the dynamic lock page differs (130/226) but static lock already applied above.
    MfUltralightPage lock_dyn = {{0x03, 0x00, 0x00, 0x00}};
    err = mf_ultralight_poller_sync_write_page(app->nfc, 40, &lock_dyn);
    // Dynamic lock failure is non-fatal — static lock was already committed
    (void)err;
    return true;
}

static int32_t worker_thread(void* ctx) {
    App* app = ctx;
    uint8_t buf[1 + 4 + 256] = {0};
    size_t total = build_ndef(app->urls[app->url_index], buf, sizeof(buf));
    if(total == 0) {
        snprintf(app->last_msg, sizeof(app->last_msg), "URL too long");
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomTagFail);
        return 0;
    }

    size_t padded = (total + 3) & ~3u;
    while(total < padded) buf[total++] = 0x00;

    // Wait configured delay before scanning — gives user time to remove the previous tag
    // so we don't accidentally write the next URL to the same tag again
    uint32_t wait_total = app->delay_ms;
    for(uint32_t wait_ms = 0; wait_ms < wait_total && !app->stop_request; wait_ms += 50) {
        furi_delay_ms(50);
    }
    if(app->stop_request) {
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomAbort);
        return 0;
    }

    app->tag_present = false;
    app->last_err = MfUltralightErrorNone;
    app->scanner = nfc_scanner_alloc(app->nfc);
    nfc_scanner_start(app->scanner, scanner_cb, app);

    uint32_t deadline = furi_get_tick() + furi_ms_to_ticks(30000);
    while(!app->tag_present && !app->stop_request && furi_get_tick() < deadline) {
        furi_delay_ms(50);
    }
    nfc_scanner_stop(app->scanner);
    nfc_scanner_free(app->scanner);
    app->scanner = NULL;

    if(app->stop_request) {
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomAbort);
        return 0;
    }
    if(!app->tag_present) {
        snprintf(app->last_msg, sizeof(app->last_msg), "Timeout - no tag");
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomTagFail);
        return 0;
    }
    if(app->last_err != MfUltralightErrorNone) {
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomTagFail);
        return 0;
    }

    size_t pages = padded / 4;
    for(size_t p = 0; p < pages; p++) {
        MfUltralightPage pg;
        memcpy(pg.data, &buf[p * 4], 4);
        MfUltralightError err =
            mf_ultralight_poller_sync_write_page(app->nfc, NDEF_START_PAGE + p, &pg);
        if(err != MfUltralightErrorNone) {
            snprintf(
                app->last_msg,
                sizeof(app->last_msg),
                "Write failed @ pg %u (err %d)",
                (unsigned)(NDEF_START_PAGE + p),
                err);
            view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomTagFail);
            return 0;
        }
    }
    // All NDEF pages written successfully — optionally lock the tag
    if(app->lock_after_write) {
        bool locked = lock_tag(app);
        if(!locked) {
            // NDEF write succeeded; report partial success — locking failed
            snprintf(
                app->last_msg,
                sizeof(app->last_msg),
                "Write OK, lock failed");
            view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomTagOk);
            return 0;
        }
    }
    snprintf(
        app->last_msg,
        sizeof(app->last_msg),
        "OK %zu/%zu",
        app->url_index + 1,
        app->url_count);
    view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomTagOk);
    return 0;
}

static void start_worker(App* app) {
    app->stop_request = false;
    app->worker = furi_thread_alloc_ex("ndef_worker", 2048, worker_thread, app);
    furi_thread_start(app->worker);
}

static void join_worker(App* app) {
    if(!app->worker) return;
    app->stop_request = true;
    furi_thread_join(app->worker);
    furi_thread_free(app->worker);
    app->worker = NULL;
}

static void on_btn_write(GuiButtonType b, InputType t, void* c) {
    (void)b;
    if(t != InputTypeShort) return;  // filter out repeat and long-press events
    App* a = c;
    view_dispatcher_send_custom_event(a->view_dispatcher, EvtCustomStart);
}

static void on_btn_quit(GuiButtonType b, InputType t, void* c) {
    (void)b;
    if(t != InputTypeShort) return;  // filter out repeat and long-press events
    App* a = c;
    view_dispatcher_send_custom_event(a->view_dispatcher, EvtCustomAbort);
}

static void build_confirm(App* app) {
    widget_reset(app->w_confirm);
    char header[40];
    snprintf(header, sizeof(header), "Tag %zu / %zu", app->url_index + 1, app->url_count);
    widget_add_string_element(app->w_confirm, 64, 2, AlignCenter, AlignTop, FontPrimary, header);
    char preview[36];
    snprintf(
        preview,
        sizeof(preview),
        "%.32s%s",
        app->urls[app->url_index],
        strlen(app->urls[app->url_index]) > 32 ? "..." : "");
    widget_add_string_multiline_element(
        app->w_confirm, 64, 30, AlignCenter, AlignCenter, FontSecondary, preview);
    // Write on OK, Quit on Right — no Skip button
    widget_add_button_element(
        app->w_confirm, GuiButtonTypeCenter, "Write", on_btn_write, app);
    widget_add_button_element(
        app->w_confirm, GuiButtonTypeRight, "Quit", on_btn_quit, app);
}

static void on_result(DialogExResult r, void* c) {
    App* a = c;
    switch(r) {
    case DialogExResultCenter:
        if(a->show_done) {
            // "All done" screen: OK returns to main menu for another batch
            view_dispatcher_send_custom_event(a->view_dispatcher, EvtCustomGoMenu);
        } else {
            // Unused path (success screen no longer shown), kept for safety
            view_dispatcher_send_custom_event(a->view_dispatcher, EvtCustomSkip);
        }
        break;
    case DialogExResultLeft:
        // Left button: retry on failure screen
        view_dispatcher_send_custom_event(a->view_dispatcher, EvtCustomRetry);
        break;
    case DialogExResultRight:
        // Right button → quit the app
        view_dispatcher_send_custom_event(a->view_dispatcher, EvtCustomAbort);
        break;
    default:
        break;
    }
}

// Show the write-failure result screen (Retry / Quit)
static void show_result_fail(App* app) {
    app->show_done = false;
    dialog_ex_reset(app->d_result);
    dialog_ex_set_header(app->d_result, "Failed", 64, 4, AlignCenter, AlignTop);
    dialog_ex_set_text(app->d_result, app->last_msg, 64, 28, AlignCenter, AlignCenter);
    // Left → EvtCustomRetry → retry this URL
    dialog_ex_set_left_button_text(app->d_result, "Retry");
    // Right → EvtCustomAbort → exits the app
    dialog_ex_set_right_button_text(app->d_result, "Quit");
    dialog_ex_set_result_callback(app->d_result, on_result);
    dialog_ex_set_context(app->d_result, app);
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdResult);
}

static void show_result_done(App* app) {
    app->show_done = true;
    dialog_ex_reset(app->d_result);
    dialog_ex_set_header(app->d_result, "All done!", 64, 4, AlignCenter, AlignTop);
    snprintf(app->last_msg, sizeof(app->last_msg), "Wrote %zu tags", app->url_count);
    dialog_ex_set_text(app->d_result, app->last_msg, 64, 28, AlignCenter, AlignCenter);
    // Center button "OK" → EvtCustomAbort (handled via show_done flag in on_result)
    dialog_ex_set_center_button_text(app->d_result, "OK");
    dialog_ex_set_result_callback(app->d_result, on_result);
    dialog_ex_set_context(app->d_result, app);
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdResult);
}

// --- Main menu ---

static void on_menu_item(void* ctx, uint32_t index) {
    App* app = ctx;
    switch(index) {
    case 0:
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomMenuStart);
        break;
    case 1:
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomMenuFile);
        break;
    case 2:
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomMenuSettings);
        break;
    }
}

static void show_menu(App* app) {
    submenu_reset(app->menu);
    submenu_set_header(app->menu, "Batch NDEF Writer");

    // "Start" item — show how many URLs are loaded if any
    char start_label[32];
    if(app->url_count > 0) {
        snprintf(start_label, sizeof(start_label), "Start (%zu URLs)", app->url_count);
    } else {
        snprintf(start_label, sizeof(start_label), "Start");
    }
    submenu_add_item(app->menu, start_label, 0, on_menu_item, app);
    submenu_add_item(app->menu, "Select File", 1, on_menu_item, app);
    submenu_add_item(app->menu, "Settings", 2, on_menu_item, app);

    app->at_menu = true;
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdMenu);
}

// --- File browser ---

static void on_file_picked(void* ctx) {
    App* app = ctx;
    // Copy the selected path from the output buffer to app->selected_path
    // Note: do NOT call file_browser_stop() here — this IS the browser callback;
    // stopping the browser from within its own callback risks deadlock.
    // Stop is done safely in the EvtCustomFilePicked handler instead.
    const char* path = furi_string_get_cstr(app->browser_result);
    strncpy(app->selected_path, path, sizeof(app->selected_path) - 1);
    app->selected_path[sizeof(app->selected_path) - 1] = '\0';

    // Signal the main event loop to stop the browser and return to menu
    view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomFilePicked);
}

static void show_file_browser(App* app) {
    file_browser_configure(app->file_browser, ".txt", "/ext", true, true, NULL, false);
    file_browser_set_callback(app->file_browser, on_file_picked, app);

    // Start the browser at /ext; allocate start path as local FuriString
    FuriString* start_path = furi_string_alloc_set_str("/ext");
    file_browser_start(app->file_browser, start_path);
    furi_string_free(start_path);
    app->browser_running = true;  // browser is now active

    app->at_menu = false;
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdFileBrowser);
}

// --- Settings ---

static void on_lock_change(VariableItem* item) {
    App* app = variable_item_get_context(item);
    uint8_t idx = variable_item_get_current_value_index(item);
    app->lock_after_write = (idx == 1);
    variable_item_set_current_value_text(item, app->lock_after_write ? "ON" : "OFF");
}

static void on_delay_change(VariableItem* item) {
    App* app = variable_item_get_context(item);
    uint8_t idx = variable_item_get_current_value_index(item);
    app->delay_ms = (uint32_t)idx * DELAY_STEP_MS;
    char buf[8];
    // Format as "X.Ys" using integer arithmetic to avoid float/double promotion warning
    snprintf(buf, sizeof(buf), "%u.%us", (unsigned)(idx / 10), (unsigned)(idx % 10));
    variable_item_set_current_value_text(item, buf);
}

static void show_settings(App* app) {
    variable_item_list_reset(app->settings_list);

    // Add "Delay" item: 31 values from 0.0s to 3.0s
    app->delay_item = variable_item_list_add(
        app->settings_list, "Delay", DELAY_STEP_COUNT, on_delay_change, app);

    // Set current index and display text from stored delay_ms
    uint8_t current_idx = (uint8_t)(app->delay_ms / DELAY_STEP_MS);
    if(current_idx >= DELAY_STEP_COUNT) current_idx = DELAY_STEP_COUNT - 1;
    variable_item_set_current_value_index(app->delay_item, current_idx);

    char buf[8];
    // Format as "X.Ys" using integer arithmetic to avoid float/double promotion warning
    snprintf(buf, sizeof(buf), "%u.%us", (unsigned)(current_idx / 10), (unsigned)(current_idx % 10));
    variable_item_set_current_value_text(app->delay_item, buf);

    // Add "Lock tag" item: 2 values — OFF (index 0) / ON (index 1)
    VariableItem* lock_item = variable_item_list_add(
        app->settings_list, "Lock tag", 2, on_lock_change, app);
    variable_item_set_current_value_index(lock_item, app->lock_after_write ? 1 : 0);
    variable_item_set_current_value_text(lock_item, app->lock_after_write ? "ON" : "OFF");

    app->at_menu = false;
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdSettings);
}

// --- Event callbacks ---

static bool custom_event_cb(void* ctx, uint32_t event) {
    App* app = ctx;
    switch(event) {
    case EvtCustomMenuStart: {
        // If no URLs loaded, show an error popup and stay on menu
        if(app->url_count == 0) {
            popup_reset(app->p_polling);
            popup_set_header(app->p_polling, "No URLs loaded", 64, 4, AlignCenter, AlignTop);
            popup_set_text(
                app->p_polling,
                "Select a urls.txt file\nusing 'Select File'",
                64, 30, AlignCenter, AlignCenter);
            app->at_menu = false;
            view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdPolling);
            return true;
        }
        // Reset index and show confirm screen for first tag
        app->url_index = 0;
        app->at_menu = false;
        build_confirm(app);
        view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdConfirm);
        return true;
    }
    case EvtCustomMenuFile:
        app->at_menu = false;
        show_file_browser(app);
        return true;
    case EvtCustomMenuSettings:
        show_settings(app);
        return true;
    case EvtCustomFilePicked:
        // Stop the browser here (safe: we're in the main event loop, not inside the browser callback)
        if(app->browser_running) {
            file_browser_stop(app->file_browser);
            app->browser_running = false;
        }
        // Reload URLs from the selected path and return to main menu
        free_urls(app);
        load_urls_from_path(app, app->selected_path);
        show_menu(app);
        return true;
    case EvtCustomStart: {
        if(app->worker) return true;  // prevent double-start
        popup_reset(app->p_polling);
        // Show "Tag N/M: URL" header
        snprintf(app->popup_hdr, sizeof(app->popup_hdr), "Tag %zu/%zu", app->url_index + 1, app->url_count);
        popup_set_header(app->p_polling, app->popup_hdr, 64, 4, AlignCenter, AlignTop);
        // Show truncated URL being written (stored persistently since popup holds the pointer)
        snprintf(app->url_preview, sizeof(app->url_preview), "%.60s", app->urls[app->url_index]);
        popup_set_text(app->p_polling, app->url_preview, 64, 28, AlignCenter, AlignCenter);
        view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdPolling);
        start_worker(app);
        return true;
    }
    case EvtCustomTagOk:
        // Success: advance immediately and start writing next tag
        join_worker(app);
        notification_message(app->notifications, &sequence_success);
        app->url_index++;
        if(app->url_index >= app->url_count) {
            // All tags written — show "All done" dialog with OK button
            show_result_done(app);
        } else {
            // Auto-start writing next tag — show polling screen with next URL and launch worker
            popup_reset(app->p_polling);
            snprintf(app->popup_hdr, sizeof(app->popup_hdr), "Tag %zu/%zu", app->url_index + 1, app->url_count);
            popup_set_header(app->p_polling, app->popup_hdr, 64, 4, AlignCenter, AlignTop);
            snprintf(app->url_preview, sizeof(app->url_preview), "%.60s", app->urls[app->url_index]);
            popup_set_text(app->p_polling, app->url_preview, 64, 28, AlignCenter, AlignCenter);
            view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdPolling);
            start_worker(app);
        }
        return true;
    case EvtCustomTagFail:
        join_worker(app);
        notification_message(app->notifications, &sequence_error);
        show_result_fail(app);
        return true;
    case EvtCustomSkip:
        app->url_index++;
        if(app->url_index >= app->url_count) {
            // All done after skipping — show done screen
            show_result_done(app);
        } else {
            build_confirm(app);
            view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdConfirm);
        }
        return true;
    case EvtCustomRetry:
        build_confirm(app);
        view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdConfirm);
        return true;
    case EvtCustomGoMenu:
        // Return to main menu (e.g. after "All done" screen)
        free_urls(app);
        load_urls_from_path(app, app->selected_path);
        show_menu(app);
        return true;
    case EvtCustomAbort:
        join_worker(app);
        view_dispatcher_stop(app->view_dispatcher);
        return true;
    }
    return false;
}

static bool nav_cb(void* ctx) {
    App* app = ctx;
    if(app->at_menu) {
        // Back from main menu → quit the application
        join_worker(app);
        view_dispatcher_stop(app->view_dispatcher);
        return true;
    }
    // Back from any other screen → stop worker, stop browser (only if running), return to menu
    join_worker(app);
    if(app->browser_running) {
        file_browser_stop(app->file_browser);
        app->browser_running = false;
    }
    show_menu(app);
    return true;
}

int32_t batch_ndef_writer_app(void* p) {
    UNUSED(p);
    App* app = malloc(sizeof(App));
    memset(app, 0, sizeof(App));

    // Initialize settings defaults
    app->delay_ms = DELAY_DEFAULT_MS;
    app->lock_after_write = false;
    strncpy(app->selected_path, URLS_PATH, sizeof(app->selected_path) - 1);
    app->selected_path[sizeof(app->selected_path) - 1] = '\0';

    // Try to load URLs from default path — may fail, user can select file from menu
    load_urls_from_path(app, app->selected_path);

    app->gui = furi_record_open(RECORD_GUI);
    app->notifications = furi_record_open(RECORD_NOTIFICATION);
    app->nfc = nfc_alloc();

    app->view_dispatcher = view_dispatcher_alloc();
    view_dispatcher_attach_to_gui(app->view_dispatcher, app->gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_set_event_callback_context(app->view_dispatcher, app);
    view_dispatcher_set_custom_event_callback(app->view_dispatcher, custom_event_cb);
    view_dispatcher_set_navigation_event_callback(app->view_dispatcher, nav_cb);

    // Allocate GUI modules
    app->w_confirm = widget_alloc();
    app->p_polling = popup_alloc();
    app->d_result = dialog_ex_alloc();
    app->menu = submenu_alloc();
    app->browser_result = furi_string_alloc();
    app->file_browser = file_browser_alloc(app->browser_result);
    app->settings_list = variable_item_list_alloc();

    // Register views with the dispatcher
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdMenu, submenu_get_view(app->menu));
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdFileBrowser, file_browser_get_view(app->file_browser));
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdSettings, variable_item_list_get_view(app->settings_list));
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdConfirm, widget_get_view(app->w_confirm));
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdPolling, popup_get_view(app->p_polling));
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdResult, dialog_ex_get_view(app->d_result));

    // Start with the main menu
    show_menu(app);

    view_dispatcher_run(app->view_dispatcher);

    // Teardown
    join_worker(app);
    if(app->browser_running) {
        file_browser_stop(app->file_browser);
        app->browser_running = false;
    }

    view_dispatcher_remove_view(app->view_dispatcher, ViewIdMenu);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdFileBrowser);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdSettings);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdConfirm);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdPolling);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdResult);

    submenu_free(app->menu);
    file_browser_free(app->file_browser);
    furi_string_free(app->browser_result);
    variable_item_list_free(app->settings_list);
    widget_free(app->w_confirm);
    popup_free(app->p_polling);
    dialog_ex_free(app->d_result);
    view_dispatcher_free(app->view_dispatcher);

    nfc_free(app->nfc);
    furi_record_close(RECORD_NOTIFICATION);
    furi_record_close(RECORD_GUI);
    free_urls(app);
    free(app);
    return 0;
}

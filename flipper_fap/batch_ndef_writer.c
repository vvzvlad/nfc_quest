#include <furi.h>
#include <gui/gui.h>
#include <gui/view_dispatcher.h>
#include <gui/elements.h>
#include <gui/modules/dialog_ex.h>
#include <gui/modules/submenu.h>
#include <gui/modules/file_browser.h>
#include <gui/modules/variable_item_list.h>
#include <input/input.h>
#include <storage/storage.h>
#include <toolbox/stream/buffered_file_stream.h>
#include <toolbox/stream/file_stream.h>
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

// Feedback for a successful scan: vibrate while flashing the LED green
static const NotificationSequence sequence_scan_ok = {
    &message_vibro_on,
    &message_green_255,
    &message_delay_100,
    &message_green_0,
    &message_vibro_off,
    NULL,
};

typedef enum {
    ViewIdMenu = 0,       // Submenu — main menu
    ViewIdFileBrowser,    // FileBrowser — file picker
    ViewIdSettings,       // VariableItemList — delay config
    ViewIdPolling,        // View — waiting for tag (custom draw with button hints)
    ViewIdResult,         // DialogEx — error or done screen
} ViewId;

typedef enum {
    EvtCustomSkip = 100,
    EvtCustomRetry,
    EvtCustomAbort,        // quit the application
    EvtCustomTagOk,
    EvtCustomTagFail,
    EvtCustomMenuStart,    // "Start" selected in main menu
    EvtCustomMenuFile,     // "Select File" selected in main menu
    EvtCustomMenuSettings, // "Settings" selected in main menu
    EvtCustomFilePicked,   // file selected in file browser
    EvtCustomGoMenu,       // return to main menu (used after "All done" screen)
    EvtCustomStoppedByUser, // worker was stopped by user (Back button) — go to menu, not quit
    EvtCustomMenuScan,     // "Scan" selected in main menu
    EvtCustomScanResult,   // scan worker read a tag — refresh the popup with the URL
    EvtCustomScanReady,    // scan worker is ready for the next tag — reset the popup
} CustomEvent;

typedef struct {
    Gui* gui;
    ViewDispatcher* view_dispatcher;
    View* v_polling;
    DialogEx* d_result;
    NotificationApp* notifications;

    // GUI modules
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
    char popup_hdr[40];   // persistent storage for polling view header string (read by draw callback)
    char url_preview[64]; // persistent storage for URL preview on polling screen (read by draw callback)
    char scan_result[128];// persistent storage for the URL read in Scan mode (read by draw callback)
    volatile bool scan_ok;// true when the last scan read a valid URL (drives the green/vibro feedback)

    // Settings and state
    uint32_t delay_ms;          // delay between tags in ms (default 1000)
    bool lock_after_write;      // if true, lock tag after writing NDEF (irreversible)
    char selected_path[256];    // currently selected urls.txt path
    bool at_menu;               // true when main menu is the active view
    bool show_done;             // true when showing "All done" in result dialog
    bool browser_running;       // true while FileBrowser is active (guards file_browser_stop calls)
    volatile bool skip_pending;  // true when Right was pressed to skip current tag; checked in EvtCustomStoppedByUser
    volatile bool in_write_mode; // true when polling view is in write mode (not scan mode)
} App;

// Module-level app pointer used by polling_input_cb.
// Safe for FAP: each FAP runs as a single instance in its own process.
static App* s_app = NULL;

// --- Settings persistence ---

// Save delay_ms, lock_after_write, and selected_path to APP_DATA_PATH("settings.cfg")
static void save_settings(App* app) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    Stream* s = file_stream_alloc(storage);
    if(file_stream_open(s, APP_DATA_PATH("settings.cfg"), FSAM_WRITE, FSOM_CREATE_ALWAYS)) {
        FuriString* line = furi_string_alloc();

        furi_string_printf(line, "delay_ms=%lu\n", (unsigned long)app->delay_ms);
        stream_write_string(s, line);

        furi_string_printf(line, "lock_after_write=%d\n", (int)app->lock_after_write);
        stream_write_string(s, line);

        furi_string_printf(line, "selected_path=%s\n", app->selected_path);
        stream_write_string(s, line);

        furi_string_free(line);
        file_stream_close(s);
    }
    stream_free(s);
    furi_record_close(RECORD_STORAGE);
}

// Load delay_ms, lock_after_write, and selected_path from APP_DATA_PATH("settings.cfg")
// Missing or corrupt file is silently ignored — defaults remain in effect
static void load_settings(App* app) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    Stream* s = file_stream_alloc(storage);
    if(file_stream_open(s, APP_DATA_PATH("settings.cfg"), FSAM_READ, FSOM_OPEN_EXISTING)) {
        FuriString* line = furi_string_alloc();
        while(stream_read_line(s, line)) {
            furi_string_trim(line);
            const char* cstr = furi_string_get_cstr(line);
            if(strncmp(cstr, "delay_ms=", 9) == 0) {
                app->delay_ms = (uint32_t)atoi(cstr + 9);
                if(app->delay_ms > 3000) app->delay_ms = 3000;
            } else if(strncmp(cstr, "lock_after_write=", 17) == 0) {
                app->lock_after_write = atoi(cstr + 17) != 0;
            } else if(strncmp(cstr, "selected_path=", 14) == 0) {
                strncpy(app->selected_path, cstr + 14, sizeof(app->selected_path) - 1);
                app->selected_path[sizeof(app->selected_path) - 1] = '\0';
            }
        }
        furi_string_free(line);
        file_stream_close(s);
    }
    stream_free(s);
    furi_record_close(RECORD_STORAGE);
}

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

// Reverse of pick_prefix: map a URI-record prefix code back to its string
static const char* prefix_string(uint8_t code) {
    switch(code) {
    case 0x01: return "http://www.";
    case 0x02: return "https://www.";
    case 0x03: return "http://";
    case 0x04: return "https://";
    case 0x05: return "tel:";
    case 0x06: return "mailto:";
    default: return "";
    }
}

// Parse an NDEF URI record out of a raw page dump (reverse of build_ndef).
// Walks the TLV chain to the NDEF message TLV (0x03), then decodes the first
// URI record ('U', type 0x55) into out as prefix + URI. Returns false if no
// URI record is found or the data is malformed/truncated.
static bool parse_ndef_url(const uint8_t* buf, size_t len, char* out, size_t out_cap) {
    size_t i = 0;
    // Skip leading TLVs until the NDEF message TLV (0x03)
    while(i < len && buf[i] != 0x03) {
        uint8_t t = buf[i];
        if(t == 0xFE) return false;   // terminator TLV — no NDEF message
        if(t == 0x00) { i++; continue; }  // NULL TLV — single byte, no length
        if(i + 1 >= len) return false;
        i += 2 + buf[i + 1];          // type + length + value
    }
    if(i >= len || buf[i] != 0x03) return false;
    i++;
    if(i >= len) return false;
    size_t ndef_len = buf[i++];
    if(ndef_len == 0xFF) {            // 3-byte length form
        if(i + 1 >= len) return false;
        ndef_len = ((size_t)buf[i] << 8) | buf[i + 1];
        i += 2;
    }
    (void)ndef_len;

    // NDEF record: header, type length, payload length, type, payload
    if(i >= len) return false;
    i++;                              // record header (e.g. 0xD1)
    if(i >= len) return false;
    uint8_t type_len = buf[i++];
    if(i >= len) return false;
    size_t payload_len = buf[i++];
    if(i + type_len > len) return false;
    uint8_t rtype = (type_len >= 1) ? buf[i] : 0;
    i += type_len;
    if(rtype != 0x55) return false;   // not a URI ('U') record
    if(payload_len == 0 || i >= len) return false;

    uint8_t prefix = buf[i++];
    payload_len--;                    // remaining payload is the URI string

    size_t pos = 0;
    for(const char* p = prefix_string(prefix); *p && pos < out_cap - 1; p++) {
        out[pos++] = *p;
    }
    for(size_t k = 0; k < payload_len && i + k < len && pos < out_cap - 1; k++) {
        out[pos++] = (char)buf[i + k];
    }
    out[pos] = '\0';
    return true;
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
// Applies static lock bytes (page 2, bytes 2-3) and dynamic lock bytes on the
// correct page for the detected tag variant (NTAG213/215/216).
// Returns true if static locking succeeded (dynamic lock failure is non-fatal).
static bool lock_tag(App* app) {
    // Step 1: Read CC (Capability Container, page 3) to determine tag variant.
    // CC byte 2 encodes total NDEF memory in units of 8 bytes:
    //   NTAG213: 0x12 × 8 = 144 B → 45 pages  → dynamic lock page = 40
    //   NTAG215: 0x3E × 8 = 496 B → 135 pages → dynamic lock page = 130
    //   NTAG216: 0x6D × 8 = 888 B → 231 pages → dynamic lock page = 226
    MfUltralightPage cc_page;
    MfUltralightError err = mf_ultralight_poller_sync_read_page(app->nfc, 3, &cc_page);
    if(err != MfUltralightErrorNone) {
        return false;
    }
    uint8_t cc2 = cc_page.data[2];  // total NDEF size / 8
    uint16_t dyn_lock_page;
    uint8_t  dyn_lock_val;           // all bits to lock entire user memory
    if(cc2 <= 0x12) {
        dyn_lock_page = 40;
        dyn_lock_val  = 0xFF;  // 8 lock bits → blocks pages 16-39 fully on NTAG213
    } else if(cc2 <= 0x3E) {
        dyn_lock_page = 130;
        dyn_lock_val  = 0xFF;
    } else {
        dyn_lock_page = 226;
        dyn_lock_val  = 0xFF;
    }

    // Step 2: Read current page 2 (bytes 0-1 hold UID bytes 4-5; must be preserved)
    MfUltralightPage page2;
    err = mf_ultralight_poller_sync_read_page(app->nfc, 2, &page2);
    if(err != MfUltralightErrorNone) {
        return false;
    }
    // Step 3: Set static lock bits (bytes 2-3 = 0xFF 0xFF) — permanently write-protects pages 3-15
    page2.data[2] = 0xFF;
    page2.data[3] = 0xFF;
    err = mf_ultralight_poller_sync_write_page(app->nfc, 2, &page2);
    if(err != MfUltralightErrorNone) {
        return false;
    }
    // Step 4: Write dynamic lock bytes to the variant-correct page (byte 3 = RFUI, must be 0)
    MfUltralightPage lock_dyn = {{dyn_lock_val, 0x00, 0x00, 0x00}};
    err = mf_ultralight_poller_sync_write_page(app->nfc, dyn_lock_page, &lock_dyn);
    // Dynamic lock failure is non-fatal — static lock was already committed
    (void)err;
    return true;
}

static int32_t worker_thread(void* ctx) {
    App* app = ctx;
    uint8_t buf[270] = {0};  // fits max NDEF: TLV(4) + record header(4) + payload(255) + terminator(1) = 264
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
        // User pressed Back during delay — return to menu, not quit
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomStoppedByUser);
        return 0;
    }

    app->tag_present = false;
    app->last_err = MfUltralightErrorNone;
    app->scanner = nfc_scanner_alloc(app->nfc);
    nfc_scanner_start(app->scanner, scanner_cb, app);

    // Wait indefinitely until a tag is detected or user presses Back
    while(!app->tag_present && !app->stop_request) {
        furi_delay_ms(50);
    }
    nfc_scanner_stop(app->scanner);
    nfc_scanner_free(app->scanner);
    app->scanner = NULL;

    if(app->stop_request) {
        // User pressed Back while waiting for tag — return to menu, not quit
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomStoppedByUser);
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
            // Provide human-readable error message based on error code
            const char* err_str = "unknown";
            if(err == MfUltralightErrorNotPresent) err_str = "tag removed";
            else if(err == MfUltralightErrorProtocol) err_str = "tag locked/NAK";
            else if(err == MfUltralightErrorAuth) err_str = "auth required";
            else if(err == MfUltralightErrorTimeout) err_str = "timeout";
            snprintf(
                app->last_msg,
                sizeof(app->last_msg),
                "Write failed: %s",
                err_str);
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
    app->skip_pending = false;  // clear skip flag on every new write cycle
    app->worker = furi_thread_alloc_ex("ndef_worker", 4096, worker_thread, app);  // 4 KiB: sync NFC poller needs headroom
    furi_thread_start(app->worker);
}

static void join_worker(App* app) {
    if(!app->worker) return;
    app->stop_request = true;
    furi_thread_join(app->worker);
    furi_thread_free(app->worker);
    app->worker = NULL;
}

// Scan mode: loop forever detecting a tag, reading its NDEF URI, and pushing
// the result to the popup. Exits only when the user presses Back (stop_request).
static int32_t scan_worker_thread(void* ctx) {
    App* app = ctx;
    while(!app->stop_request) {
        // Wait for any MfUltralight tag to appear
        app->tag_present = false;
        app->last_err = MfUltralightErrorNone;
        app->scanner = nfc_scanner_alloc(app->nfc);
        nfc_scanner_start(app->scanner, scanner_cb, app);
        while(!app->tag_present && !app->stop_request) {
            furi_delay_ms(50);
        }
        nfc_scanner_stop(app->scanner);
        nfc_scanner_free(app->scanner);
        app->scanner = NULL;
        if(app->stop_request) break;

        app->scan_ok = false;
        if(app->last_err != MfUltralightErrorNone) {
            snprintf(app->scan_result, sizeof(app->scan_result), "Not an NTAG/MFUL tag");
        } else {
            // Read the whole tag in a single activation cycle (much faster than
            // reading page-by-page, which re-activates the card for every page)
            MfUltralightData* mfu = mf_ultralight_alloc();
            mf_ultralight_poller_sync_read_card(app->nfc, mfu, NULL);

            uint8_t buf[160];
            size_t got = 0;
            for(uint16_t p = NDEF_START_PAGE;
                p < mfu->pages_read && got + 4 <= sizeof(buf);
                p++) {
                memcpy(&buf[got], mfu->page[p].data, 4);
                got += 4;
            }
            mf_ultralight_free(mfu);

            if(got == 0) {
                snprintf(app->scan_result, sizeof(app->scan_result), "Read failed");
            } else if(parse_ndef_url(buf, got, app->scan_result, sizeof(app->scan_result))) {
                app->scan_ok = true;  // valid URL — triggers green/vibro feedback
            } else {
                snprintf(app->scan_result, sizeof(app->scan_result), "No URL on tag");
            }
        }
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomScanResult);

        // Show the result for ~1s, then reset to the "ready" screen for the next tag
        for(uint32_t w = 0; w < 1000 && !app->stop_request; w += 50) {
            furi_delay_ms(50);
        }
        if(app->stop_request) break;
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomScanReady);
    }
    view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomStoppedByUser);
    return 0;
}

// Force redraw of the polling view by committing its dummy model.
static void polling_view_update(App* app) {
    with_view_model(app->v_polling, uint8_t* dummy, { (*dummy)++; }, true);
}

// Draw callback for the polling view — renders header, body text, and (in write mode) button hints.
static void polling_draw_cb(Canvas* canvas, void* model) {
    (void)model;
    App* app = s_app;
    if(!app) return;

    canvas_clear(canvas);
    canvas_set_color(canvas, ColorBlack);

    // Header line at top
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str_aligned(canvas, 64, 10, AlignCenter, AlignBottom, app->popup_hdr);

    // Body text in the center area — multiline to handle long URLs and "\n" sequences
    canvas_set_font(canvas, FontSecondary);
    // Use url_preview in write mode, scan_result in scan mode
    const char* body = app->in_write_mode ? app->url_preview : app->scan_result;
    elements_multiline_text_aligned(canvas, 64, 32, AlignCenter, AlignCenter, body);

    // Button hints — only in write mode
    if(app->in_write_mode) {
        elements_button_right(canvas, "Skip");
        canvas_set_font(canvas, FontSecondary);
        canvas_draw_str(canvas, 2, 63, "Hold Back");
    }
}

// Show the scan view and start the scan worker loop
static void show_scan_and_start(App* app) {
    snprintf(app->popup_hdr, sizeof(app->popup_hdr), "Scanning");
    snprintf(app->scan_result, sizeof(app->scan_result), "Hold a tag to back");
    app->at_menu = false;
    app->in_write_mode = false;
    polling_view_update(app);
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdPolling);

    app->stop_request = false;
    app->worker = furi_thread_alloc_ex("scan_worker", 4096, scan_worker_thread, app);
    furi_thread_start(app->worker);
}

// Input callback for the polling view — handles Right (skip) and Back long press (stop).
// Only active in write mode; scan mode leaves all input to the default nav_cb.
static bool polling_input_cb(InputEvent* event, void* ctx) {
    (void)ctx;                            // context unused — App* comes from module-level s_app
    App* app = s_app;
    if(!app || !app->in_write_mode) return false; // scan mode or not yet initialized: default nav_cb handles Back

    if(event->key == InputKeyRight && event->type == InputTypeShort) {
        // Right short press — skip current tag
        if(app->worker) {
            app->skip_pending = true;
            app->stop_request = true;
        } else {
            // No active worker (edge case), send skip event directly
            view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomSkip);
        }
        return true; // consumed
    }

    if(event->key == InputKeyBack) {
        if(event->type == InputTypeLong) {
            // Long press Back — stop worker and return to menu
            if(app->worker) {
                app->stop_request = true;
            } else {
                view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomStoppedByUser);
            }
        }
        // Consume ALL Back key events in write mode:
        // short press does nothing (prevents nav_cb from firing),
        // long press triggers stop above.
        return true;
    }

    return false;
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
        // Left button: retry on failure screen — go straight to polling
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
    // Left → EvtCustomRetry → retry this URL (goes straight to polling)
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
    // Center button "OK" → EvtCustomGoMenu (handled via show_done flag in on_result)
    dialog_ex_set_center_button_text(app->d_result, "OK");
    dialog_ex_set_result_callback(app->d_result, on_result);
    dialog_ex_set_context(app->d_result, app);
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdResult);
}

// Show the polling view for the current URL index and start the worker
static void show_polling_and_start(App* app) {
    snprintf(app->popup_hdr, sizeof(app->popup_hdr), "Tag %zu/%zu", app->url_index + 1, app->url_count);
    // Show truncated URL being written (stored persistently; draw callback holds pointer)
    snprintf(app->url_preview, sizeof(app->url_preview), "%.60s", app->urls[app->url_index]);
    app->at_menu = false;
    app->in_write_mode = true;
    polling_view_update(app);
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdPolling);
    start_worker(app);
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
    case 3:
        view_dispatcher_send_custom_event(app->view_dispatcher, EvtCustomMenuScan);
        break;
    }
}

static void show_menu(App* app) {
    app->in_write_mode = false;  // safety reset: ensure write mode is cleared on menu return
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
    submenu_add_item(app->menu, "Scan", 3, on_menu_item, app);

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
        // If no URLs loaded, show an error view and stay (back returns to menu via nav_cb)
        if(app->url_count == 0) {
            snprintf(app->popup_hdr, sizeof(app->popup_hdr), "No URLs loaded");
            snprintf(app->scan_result, sizeof(app->scan_result), "Select a urls.txt\nusing Select File");
            app->in_write_mode = false;
            app->at_menu = false;
            polling_view_update(app);
            view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdPolling);
            return true;
        }
        // Reset index and go straight to polling — no confirm screen
        app->url_index = 0;
        show_polling_and_start(app);
        return true;
    }
    case EvtCustomMenuFile:
        app->at_menu = false;
        show_file_browser(app);
        return true;
    case EvtCustomMenuSettings:
        show_settings(app);
        return true;
    case EvtCustomMenuScan:
        show_scan_and_start(app);
        return true;
    case EvtCustomScanResult:
        // Worker read a tag — update fields and redraw. scan_result is already set by worker.
        snprintf(app->popup_hdr, sizeof(app->popup_hdr), "Scan result");
        polling_view_update(app);
        // Vibrate and flash green only when a valid URL was read
        if(app->scan_ok) {
            notification_message(app->notifications, &sequence_scan_ok);
        }
        return true;
    case EvtCustomScanReady:
        // Result shown long enough — reset to the ready screen for the next tag
        snprintf(app->popup_hdr, sizeof(app->popup_hdr), "Scanning");
        snprintf(app->scan_result, sizeof(app->scan_result), "Hold a tag to back");
        polling_view_update(app);
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
            show_polling_and_start(app);
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
            // Go straight to polling for the next URL
            show_polling_and_start(app);
        }
        return true;
    case EvtCustomRetry:
        // Retry current URL — go straight to polling, no confirm screen
        show_polling_and_start(app);
        return true;
    case EvtCustomGoMenu:
        // Return to main menu (e.g. after "All done" screen)
        free_urls(app);
        load_urls_from_path(app, app->selected_path);
        show_menu(app);
        return true;
    case EvtCustomStoppedByUser:
        // Worker stopped — either by Back (go to menu) or by Right skip (advance to next tag)
        join_worker(app);
        if(app->skip_pending) {
            app->skip_pending = false;
            app->url_index++;
            if(app->url_index >= app->url_count) {
                show_result_done(app);
            } else {
                show_polling_and_start(app);
            }
        } else {
            show_menu(app);
        }
        return true;
    case EvtCustomAbort:
        // Quit the entire application
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
        // If worker is somehow running, stop it first
        if(app->worker) {
            app->stop_request = true;
            // Don't join here — worker will send EvtCustomStoppedByUser which we won't handle
            // since view_dispatcher_stop is called; just force-stop for cleanup
            furi_thread_join(app->worker);
            furi_thread_free(app->worker);
            app->worker = NULL;
        }
        view_dispatcher_stop(app->view_dispatcher);
        return true;
    }
    if(app->worker) {
        // Worker is running (scanning or writing) — signal stop and let worker
        // send EvtCustomStoppedByUser which will call show_menu().
        // Do NOT call join_worker here (it blocks) or show_menu (worker will do it).
        app->stop_request = true;
        return true;
    }
    // No worker running — stop browser if active, return to menu directly
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

    // Override defaults with persisted settings (missing file is silently ignored)
    load_settings(app);

    // Try to load URLs from selected path — may fail, user can select file from menu
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
    // Allocate the custom polling view; s_app must be set before registering callbacks.
    app->v_polling = view_alloc();
    view_allocate_model(app->v_polling, ViewModelTypeLockFree, sizeof(uint8_t));
    s_app = app;
    view_set_draw_callback(app->v_polling, polling_draw_cb);
    view_set_input_callback(app->v_polling, polling_input_cb);
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
        app->view_dispatcher, ViewIdPolling, app->v_polling);
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdResult, dialog_ex_get_view(app->d_result));

    // Start with the main menu
    show_menu(app);

    view_dispatcher_run(app->view_dispatcher);

    // Teardown: save settings before freeing resources
    save_settings(app);

    join_worker(app);
    if(app->browser_running) {
        file_browser_stop(app->file_browser);
        app->browser_running = false;
    }

    view_dispatcher_remove_view(app->view_dispatcher, ViewIdMenu);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdFileBrowser);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdSettings);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdPolling);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdResult);

    submenu_free(app->menu);
    file_browser_free(app->file_browser);
    furi_string_free(app->browser_result);
    variable_item_list_free(app->settings_list);
    view_free(app->v_polling);
    dialog_ex_free(app->d_result);
    view_dispatcher_free(app->view_dispatcher);

    nfc_free(app->nfc);
    furi_record_close(RECORD_NOTIFICATION);
    furi_record_close(RECORD_GUI);
    free_urls(app);
    free(app);
    return 0;
}

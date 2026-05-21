#include <furi.h>
#include <gui/gui.h>
#include <gui/view_dispatcher.h>
#include <gui/modules/widget.h>
#include <gui/modules/popup.h>
#include <gui/modules/dialog_ex.h>
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

typedef enum {
    ViewIdConfirm = 0,
    ViewIdPolling,
    ViewIdResult,
} ViewId;

typedef enum {
    EvtCustomStart = 100,
    EvtCustomSkip,
    EvtCustomRetry,
    EvtCustomAbort,
    EvtCustomTagOk,
    EvtCustomTagFail,
} CustomEvent;

typedef struct {
    Gui* gui;
    ViewDispatcher* view_dispatcher;
    Widget* w_confirm;
    Popup* p_polling;
    DialogEx* d_result;
    NotificationApp* notifications;

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
} App;

static bool load_urls(App* app) {
    Storage* storage = furi_record_open(RECORD_STORAGE);
    Stream* s = buffered_file_stream_alloc(storage);
    bool ok = buffered_file_stream_open(s, URLS_PATH, FSAM_READ, FSOM_OPEN_EXISTING);
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

    // Wait 1 second before scanning — gives user time to remove the previous tag
    // so we don't accidentally write the next URL to the same tag again
    for(int wait_ms = 0; wait_ms < 1000 && !app->stop_request; wait_ms += 50) {
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
        // Center button: on success → next URL; on failure → retry
        view_dispatcher_send_custom_event(a->view_dispatcher, EvtCustomSkip);
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

static void show_result(App* app, bool ok) {
    dialog_ex_reset(app->d_result);
    dialog_ex_set_header(
        app->d_result, ok ? "Success" : "Failed", 64, 4, AlignCenter, AlignTop);
    dialog_ex_set_text(app->d_result, app->last_msg, 64, 28, AlignCenter, AlignCenter);
    if(ok) {
        // Center → EvtCustomSkip → advances to next URL
        dialog_ex_set_center_button_text(app->d_result, "Next");
        // Right → EvtCustomAbort → exits the app
        dialog_ex_set_right_button_text(app->d_result, "Quit");
    } else {
        // Left → EvtCustomRetry → retry this URL
        dialog_ex_set_left_button_text(app->d_result, "Retry");
        // Right → EvtCustomAbort → exits the app
        dialog_ex_set_right_button_text(app->d_result, "Quit");
    }
    dialog_ex_set_result_callback(app->d_result, on_result);
    dialog_ex_set_context(app->d_result, app);
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdResult);
}

static bool custom_event_cb(void* ctx, uint32_t event) {
    App* app = ctx;
    switch(event) {
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
        // Success: skip success screen, advance immediately and start writing next tag
        join_worker(app);
        notification_message(app->notifications, &sequence_success);
        app->url_index++;
        if(app->url_index >= app->url_count) {
            // All tags written — show final done message via popup then stop
            popup_reset(app->p_polling);
            popup_set_header(app->p_polling, "All done!", 64, 16, AlignCenter, AlignTop);
            snprintf(app->last_msg, sizeof(app->last_msg), "Wrote %zu tags", app->url_count);
            popup_set_text(app->p_polling, app->last_msg, 64, 36, AlignCenter, AlignCenter);
            view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdPolling);
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
        show_result(app, false);
        return true;
    case EvtCustomSkip:
        app->url_index++;
        if(app->url_index >= app->url_count) {
            view_dispatcher_stop(app->view_dispatcher);
        } else {
            build_confirm(app);
            view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdConfirm);
        }
        return true;
    case EvtCustomRetry:
        build_confirm(app);
        view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdConfirm);
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
    join_worker(app);
    view_dispatcher_stop(app->view_dispatcher);
    return true;
}

int32_t batch_ndef_writer_app(void* p) {
    UNUSED(p);
    App* app = malloc(sizeof(App));
    memset(app, 0, sizeof(App));

    if(!load_urls(app)) {
        DialogsApp* d = furi_record_open(RECORD_DIALOGS);
        DialogMessage* m = dialog_message_alloc();
        dialog_message_set_header(m, "No URLs", 64, 4, AlignCenter, AlignTop);
        dialog_message_set_text(
            m,
            "Copy urls.txt to SD:\n/ext/apps_data/\nbatch_ndef_writer/",
            64,
            32,
            AlignCenter,
            AlignCenter);
        dialog_message_set_buttons(m, NULL, "OK", NULL);
        dialog_message_show(d, m);
        dialog_message_free(m);
        furi_record_close(RECORD_DIALOGS);
        free_urls(app);  // release urls array if file existed but had no valid entries
        free(app);
        return 0;
    }

    app->gui = furi_record_open(RECORD_GUI);
    app->notifications = furi_record_open(RECORD_NOTIFICATION);
    app->nfc = nfc_alloc();

    app->view_dispatcher = view_dispatcher_alloc();
    view_dispatcher_attach_to_gui(app->view_dispatcher, app->gui, ViewDispatcherTypeFullscreen);
    view_dispatcher_set_event_callback_context(app->view_dispatcher, app);
    view_dispatcher_set_custom_event_callback(app->view_dispatcher, custom_event_cb);
    view_dispatcher_set_navigation_event_callback(app->view_dispatcher, nav_cb);

    app->w_confirm = widget_alloc();
    app->p_polling = popup_alloc();
    app->d_result = dialog_ex_alloc();
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdConfirm, widget_get_view(app->w_confirm));
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdPolling, popup_get_view(app->p_polling));
    view_dispatcher_add_view(
        app->view_dispatcher, ViewIdResult, dialog_ex_get_view(app->d_result));

    app->url_index = 0;
    build_confirm(app);
    view_dispatcher_switch_to_view(app->view_dispatcher, ViewIdConfirm);

    view_dispatcher_run(app->view_dispatcher);

    // Teardown
    join_worker(app);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdConfirm);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdPolling);
    view_dispatcher_remove_view(app->view_dispatcher, ViewIdResult);
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

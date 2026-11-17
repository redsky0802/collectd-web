// Graph font preferences. Uses the existing jQuery and browser storage only.
var graph_font_tags = ['DEFAULT', 'TITLE', 'AXIS', 'UNIT', 'LEGEND', 'WATERMARK'];
var graph_font_preferences;
var graph_font_catalog_loaded = false;
var graph_font_catalog_loading = false;

function default_graph_fonts() {
    var settings = {render: 'normal', columns: 80, fonts: {}};
    $.each(graph_font_tags, function (_, tag) {
        settings.fonts[tag] = {family: tag === 'DEFAULT' ? 'monospace' : '', size: 0};
    });
    return settings;
}

function valid_graph_font_family(value) {
    return typeof value === 'string' && value.length <= 128 &&
        !/[\x00-\x1f\x7f:;,\/\\]/.test(value);
}

function valid_graph_font_size(value) {
    return /^[0-9]{1,2}(?:\.[0-9]{1,2})?$/.test(String(value)) &&
        Number(value) <= 72;
}

function normalized_graph_fonts(value) {
    var settings = default_graph_fonts();
    if (!value || typeof value !== 'object') {
        return settings;
    }
    if (/^(normal|light|mono)$/.test(value.render)) {
        settings.render = value.render;
    }
    if (/^[0-9]{2,3}$/.test(String(value.columns)) &&
            value.columns >= 20 && value.columns <= 200) {
        settings.columns = Number(value.columns);
    }
    $.each(graph_font_tags, function (_, tag) {
        var font = value.fonts && value.fonts[tag];
        if (font) {
            if (valid_graph_font_family(font.family)) {
                settings.fonts[tag].family = $.trim(font.family);
            }
            if (valid_graph_font_size(font.size)) {
                settings.fonts[tag].size = Number(font.size);
            }
        }
    });
    settings.fonts.DEFAULT.family = settings.fonts.DEFAULT.family || 'monospace';
    return settings;
}

graph_font_preferences = default_graph_fonts();

function graph_font_url_params(params) {
    // The legacy URL builder keeps existing values encoded. Encode each new
    // family once, including spaces, non-ASCII characters and ampersands.
    $.each(graph_font_tags, function (_, tag) {
        var key = 'font_' + tag.toLowerCase();
        var font = graph_font_preferences.fonts[tag];
        delete params[key];
        delete params[key + '_size'];
        if (font.family) {
            params[key] = encodeURIComponent(font.family);
        }
        if (font.size) {
            params[key + '_size'] = font.size;
        }
    });
    params.font_render_mode = graph_font_preferences.render;
    params.title_columns = graph_font_preferences.columns;
}

function populate_graph_font_choices(families) {
    $.each(graph_font_tags, function (_, tag) {
        var select = $('#font-' + tag.toLowerCase());
        var current = select.val() || '';
        select.empty();
        if (tag !== 'DEFAULT') {
            select.append($('<option></option>').val('').text('Use DEFAULT font'));
        }
        $.each(families, function (_, family) {
            select.append($('<option></option>').val(family).text(family));
        });
        // Preserve a draft or saved choice if a server font was removed.
        if (current && $.inArray(current, families) === -1) {
            select.append($('<option></option>').val(current).text(current + ' (saved)'));
        }
        select.val(current || (tag === 'DEFAULT' ? 'monospace' : ''));
    });
}

function write_graph_font_form(settings) {
    $.each(graph_font_tags, function (_, tag) {
        var select = $('#font-' + tag.toLowerCase());
        var family = settings.fonts[tag].family;
        if (family && !select.find('option').filter(function () {
                return this.value === family;
            }).length) {
            select.append($('<option></option>').val(family).text(family + ' (saved)'));
        }
        select.val(family);
        $('#font-' + tag.toLowerCase() + '-size').val(settings.fonts[tag].size);
    });
    $('#font-render-mode').val(settings.render);
    $('#title-columns').val(settings.columns);
}

function load_server_fonts() {
    if (graph_font_catalog_loading) {
        return;
    }
    graph_font_catalog_loading = true;
    $('#refresh-server-fonts').attr('disabled', true);
    $('#font-catalog-status').text('Loading server fonts...');
    $.ajax({
        url: 'cgi-bin/collection.modified.cgi?action=fonts_json',
        dataType: 'json',
        cache: false,
        timeout: 8000,
        success: function (data) {
            var families = ['monospace'];
            if (data && $.isArray(data.fonts)) {
                $.each(data.fonts, function (_, family) {
                    if (valid_graph_font_family(family) && family &&
                            $.inArray(family, families) === -1) {
                        families.push(family);
                    }
                });
            }
            populate_graph_font_choices(families);
            $('#font-catalog-status').text(data && data.available ?
                'Server font list loaded.' :
                'Server font listing is unavailable. Monospace and saved choices remain usable.');
        },
        error: function () {
            $('#font-catalog-status').text(
                'Could not load server fonts. Monospace and saved choices remain usable; try Refresh.');
        },
        complete: function () {
            graph_font_catalog_loading = false;
            graph_font_catalog_loaded = true;
            $('#refresh-server-fonts').attr('disabled', false);
        }
    });
}

function apply_graph_fonts(settings) {
    graph_font_preferences = normalized_graph_fonts(settings);
    var saved = true;
    try {
        window.localStorage.setItem('collectd-web.fonts', JSON.stringify(graph_font_preferences));
    } catch (e) {
        saved = false;
    }
    $('.gc-img').each(function () {
        var img = $(this);
        var attribute = img.hasClass('toload') ? 'title' : 'src';
        var url = img.attr(attribute);
        if (url && get_url_params(url).action === 'show_graph') {
            var updated = build_url(url, {});
            if (updated !== url) {
                img.attr(attribute, updated);
            }
            if (attribute === 'src' && img.attr('title')) {
                img.attr('title', updated);
            }
        }
    });
    $('#font-settings-status').text(saved ? 'Applied and saved in this browser.' :
        'Applied for this session. Browser storage is unavailable.');
}

function initialize_graph_fonts() {
    var labels = ['All elements', 'Title', 'Axis labels', 'Vertical unit label',
                  'Legend', 'Watermark'];
    var sizes = ['Keep individual sizes', '14', '10', '12', '12', 'RRDtool default'];
    $.each(graph_font_tags, function (index, tag) {
        var id = 'font-' + tag.toLowerCase();
        var row = $('<tr></tr>');
        row.append($('<th scope="row"></th>').append(
            $('<label></label>').attr('for', id).text(tag + ' — ' + labels[index])));
        row.append($('<td></td>').append(
            $('<select></select>').attr({id: id, 'aria-label': tag + ' font'})));
        row.append($('<td></td>').append(
            $('<input type="number" min="0" max="72" step="any" />').attr({
                id: id + '-size', 'aria-label': tag + ' font size in points'
            })));
        row.append($('<td class="font-original-size"></td>').text(sizes[index]));
        $('#font-settings-rows').append(row);
    });
    populate_graph_font_choices(['monospace']);
    try {
        var stored = window.localStorage.getItem('collectd-web.fonts');
        graph_font_preferences = normalized_graph_fonts(stored ? JSON.parse(stored) : null);
    } catch (e) {
        graph_font_preferences = default_graph_fonts();
    }
    write_graph_font_form(graph_font_preferences);
    $('#menu-tabs').bind('tabsshow', function (event, ui) {
        if (ui.panel.id === 'fonts-tab' && !graph_font_catalog_loaded) {
            load_server_fonts();
        }
    });
    $('#refresh-server-fonts').click(load_server_fonts);
    $('#font-settings-form').submit(function () {
        var settings = default_graph_fonts();
        var error = '';
        $.each(graph_font_tags, function (_, tag) {
            var family = $('#font-' + tag.toLowerCase()).val() || '';
            var size = $('#font-' + tag.toLowerCase() + '-size').val();
            if (!valid_graph_font_family(family) || !valid_graph_font_size(size)) {
                error = 'Use a listed font and a size from 0 to 72, with at most two decimal places.';
            }
            settings.fonts[tag] = {family: family, size: Number(size)};
        });
        settings.render = $('#font-render-mode').val();
        settings.columns = $('#title-columns').val();
        if (!/^[0-9]{2,3}$/.test(settings.columns) ||
                settings.columns < 20 || settings.columns > 200) {
            error = 'Title width must be a whole number from 20 to 200 columns.';
        }
        if (error) {
            $('#font-settings-status').text(error);
            return false;
        }
        apply_graph_fonts(settings);
        return false;
    });
    $('#reset-graph-fonts').click(function () {
        var settings = default_graph_fonts();
        write_graph_font_form(settings);
        apply_graph_fonts(settings);
    });
}

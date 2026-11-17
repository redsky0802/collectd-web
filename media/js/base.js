// Collectd-web - base.js
// Copyright (C) 2009-2010  Kenneth Belitzky
//
// This program is free software; you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation; either version 2 of the License, or (at your option) any later
// version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
// FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more
// details.
//
// You should have received a copy of the GNU General Public License along with
// this program; if not, write to the Free Software Foundation, Inc.,
// 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.


/**
 * Global vars
 */
var $selected_host = '';
var $selected_plugin = '';
var $graph_json = null;
var window_top = 0;
var previous_window_top = 0;
var cpu_idle_visible = true;


// error free logger taken from:
// http://goo.gl/yG9Gb
var Fb = {}; //An empty object literal for holding the function
Fb.log = function(obj, consoleMethod) {
       if (window.console && window.console.firebug && window.console.firebug.replace(/^\s\s*/, '').replace(/\s\s*$/, '') !== '') {
               if (typeof consoleMethod === "string" && typeof console[consoleMethod] === "function") {
                       console[consoleMethod](obj);
               } else {
                       console.log(obj);
               }
       }
};

var server_tz = 0;

/**
 * Returns a current Date object, representing server time.
 */
function server_now() {
    var d = new Date(),
        local_time = d.getTime(),
        local_offset = d.getTimezoneOffset() * 60000,
        utc = local_time + local_offset,
        server = utc + (3600000 * server_tz);
    return new Date(server);
}

/*
 * checks to see if the number is negative
 *
 */
function is_neg(string) {
    var numericExpression = /^-[0-9]+$/;

    if(string.match(numericExpression)) {
        return true;
    } else {
        return false;
    }
}


/**
 * Get the id of the container for the selected element
 *
 * @param {Object}
 *            elem
 */

function get_container(elem) {
    return $(elem).parent().parent().parent().attr('id');
}

var graph_def_values = [];

function get_gmt(offset) {
    off = '';
    if (offset === 0) {
        off = '';
    } else if (offset > 0) {
        off = '+' + offset;
    } else {
        off = offset;
    }
    return offset;
}

function get_url_params(in_url) {
    var params = {};
    if (in_url) {
        var nurl = in_url.replace(/.*\?(.*?)/, "$1");
        variables = nurl.split(";");
        for (i = 0; i < variables.length; i++) {
            separ = variables[i].split("=");
            params[separ[0]] = separ[1];
        }
    }
    Fb.log(params,"info");
    return params;
}


function get_timespan_start (timespan) {
    var out_date = server_now();
    switch (timespan) {
        case "hour":
            out_date.add(-1).hours();
            break;
        case "day":
            out_date.add(-1).days();
            break;
        case "week":
            out_date.add(-1).weeks();
            break;
        case "month":
            out_date.add(-1).months();
            break;
        case "year":
            out_date.add(-1).years();
            break;
        case "decade":
            out_date.add(-10).years();
            break;
    }
    return out_date;
}

/**
 * Build up and url with the given parameters
 * @param original_url string with the original url
 * @param params hash with all parameters to add to the url
 * @return string
 */

function build_url(original_url, new_params) {
    Fb.log(new_params, "warning");
    params = get_url_params(original_url);
    $.extend(params, new_params);
    if (params.plugin === 'cpu' && params.type === 'cpu') {
        params.cpu_idle = cpu_idle_visible ? '1' : '0';
    }
    if (params.action === 'show_graph') {
        graph_font_url_params(params);
    }
    var url = original_url.split('?')[0] + '?';
    for (key in params) {
        if (params[key] !== '' || params[key] === 0) {
        url += key + '=' + params[key] + ';';
        }
    }
    Fb.log(url,"info");
    return url;
}

function is_dark_mode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function set_cpu_idle_visibility(visible) {
    cpu_idle_visible = visible;
    try {
        window.localStorage.setItem('collectd-web.cpu-idle', visible ? '1' : '0');
    } catch (e) {
        // The option still works when browser storage is unavailable.
    }
    $('.gc-img').each(function () {
        var img = $(this);
        // Update deferred requests without eagerly loading off-screen graphs.
        var attribute = img.hasClass('toload') ? 'title' : 'src';
        var url = img.attr(attribute);
        var graph_params = get_url_params(url);
        if (graph_params.plugin === 'cpu' && graph_params.type === 'cpu') {
            var updated = build_url(url, {});
            img.attr(attribute, updated);
            if (attribute === 'src' && img.attr('title')) {
                img.attr('title', updated);
            }
        }
    });
}

function restore_cpu_idle_visibility() {
    try {
        cpu_idle_visible = window.localStorage.getItem('collectd-web.cpu-idle') !== '0';
    } catch (e) {
        cpu_idle_visible = true;
    }
    $('#show-cpu-idle-checkbox').attr('checked', cpu_idle_visible);
}

function build_url_with_theme(url, params) {
    if (is_dark_mode()) {
        params.theme = 'dark';
    }
    return build_url(url, params);
}

function update_toolbar_space() {
    var height = $('#toolbar-container').outerHeight();
    if (height > 0) {
        $('#page-content').css('padding-bottom', Math.ceil(height) + 12);
    }
}

function show_toolbar_panel(panel) {
    var target = $('#toolbar-content .toolbar-item.' + panel);
    if (!target.length) {
        return;
    }
    $('#toolbar-content .toolbar-item').hide();
    target.css('display', 'flex');
    $('#toolbar-home').attr('aria-expanded', panel === 'menu-options' ? 'true' : 'false');
    update_toolbar_space();
    // Keep keyboard focus in the panel after its launching button is hidden.
    target.find('input,button').first().focus();
}

function initialize_toolbar() {
    update_toolbar_space();
    $(window).bind('resize.toolbar load.toolbar', update_toolbar_space);
    if (window.ResizeObserver) {
        var observer = new window.ResizeObserver(update_toolbar_space);
        observer.observe(document.getElementById('toolbar-container'));
    }
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(update_toolbar_space);
    }
}

var graph_view_preferences = {width: 'normal', layout: 'list', columns: 2};

function restore_graph_view() {
    try {
        var saved = window.localStorage.getItem('collectd-web.view');
        if (saved) {
            var preferences = JSON.parse(saved);
            if (preferences && typeof preferences === 'object') {
                graph_view_preferences.width = preferences.width === 'wide' ? 'wide' : 'normal';
                graph_view_preferences.layout = preferences.layout === 'grid' ? 'grid' : 'list';
                if (preferences.columns === 2 || preferences.columns === 4 || preferences.columns === 8) {
                    graph_view_preferences.columns = preferences.columns;
                }
            }
        } else {
            // Preserve R2's four-column choice by opening it in Wide mode.
            var legacy = window.localStorage.getItem('collectd-web.graph-view');
            if (legacy === 'grid-2' || legacy === 'grid-4') {
                graph_view_preferences.layout = 'grid';
                graph_view_preferences.columns = legacy === 'grid-4' ? 4 : 2;
                graph_view_preferences.width = legacy === 'grid-4' ? 'wide' : 'normal';
            }
        }
    } catch (error) {
        // Defaults also work with invalid JSON or unavailable browser storage.
    }
    set_graph_view(false);
}

function set_graph_view(remember) {
    var preferences = graph_view_preferences;
    var narrow = window.matchMedia && window.matchMedia('(max-width: 767.98px)').matches;
    var wide = preferences.width === 'wide' && !narrow;
    var columns = wide ? preferences.columns : 2;
    var view = preferences.layout === 'grid' ? 'grid-' + columns : 'list';

    $('body').attr('data-page-width', preferences.width);
    // This container survives host/plugin changes and asynchronous graph loads.
    $('#graph-container').attr('data-graph-view', view);
    $('#view-container input[type="radio"]').each(function () {
        var value = this.name === 'page-width' ? preferences.width : preferences.layout;
        this.checked = this.value === value;
        $(this).closest('.graph-view-option').toggleClass('selected ui-state-active', this.checked);
    });

    var select = $('#graph-columns');
    if (select.data('wide') !== wide) {
        select.html(wide ? '<option value="2">2</option><option value="4">4</option><option value="8">8</option>' : '<option value="2">2</option>');
        select.data('wide', wide);
    }
    select.val(String(columns));
    update_toolbar_space();

    if (remember) {
        try {
            // Keep the preferred wide-screen columns when temporarily capped.
            window.localStorage.setItem('collectd-web.view', JSON.stringify(preferences));
        } catch (error) {
            // The view still works when browser storage is unavailable.
        }
    }
    lazy_check();
}

/**
 * default control container
 *
 * @param {Object}
 *            txt
 */

function control_container(txt) {
    return '<div class="icons ui-state-default ui-corner-all">' + txt + '</div>';
}

/**
 * return html structure for the available plugins menu
 * @param host
 * @param plugins
 * @return
 */

function create_plugin_menu(host, plugins) {
    var tpl = '<div><div class="ui-widget-header ui-corner-top"><h3>Available Plugins</h3></div>';
    tpl += '<div id="plugin-container" class="ui-widget-content ui-corner-bottom  "><ul>';
    for (var p = 0; p < plugins.length; p++) {
        tpl += '<li><a href="cgi-bin/collection.modified.cgi?action=show_plugin;host=' + host +
            ';timespan=day;plugin=' + plugins[p] + '" onclick="window.scrollTo(0, 0)">' + plugins[p] + '</a></li>';
    }
    tpl += '</ul></div>';
    tpl += '</div>';
    return tpl;
}

function get_graph_menu() {
    return $('#graph-menu-partial').html();
}

function update_all_graphs(start, end) {
    $('.gc-img').each(function () {
        var $this = $(this),
            attribute = $this.hasClass('toload') ? 'title' : 'src',
            new_url = build_url_with_theme($this.attr(attribute), {
            'start': print_date(start),
            'end': print_date(end)
        });
        $this.attr(attribute, new_url);
    });
}

function get_graph_main_container(host) {
    $('.graph-main-container .hostname').html(host);
    return $('.graph-main-container').html();
}

function show_lazy_graph(elem) {
    $(elem).attr('src', $(elem).attr('title'));
}

function initialize_graph_sorting() {
    $('#graph-container .sortable').sortable({cancel: ':input,option,.gc-menu'});
}

function create_graph_list(timespan, graphs) {
    var end_date = server_now();
    var start_date = get_timespan_start(timespan);

    var $tpl = '';
    var final_url = '';
    $tpl += '<li class="ui-widget graph-image ' + timespan + '">';
    $tpl += '<ul class="sortable ui-sortable">';
    for (var g = 0; g < graphs.length; g++) {
        final_url = build_url_with_theme(graphs[g], {'start': print_date(start_date), 'end': print_date(end_date)});
        $tpl += '<li class="gc">';
        $tpl += get_graph_menu();
        if ($('#graph-caching-checkbox').attr('checked')) {
            $tpl += '<img class="gc-img toload" src="media/images/graph-load.png" title="' + final_url + '"/>';
        } else {
            $tpl += '<img class="gc-img" src="' + final_url + '"/>';
        }
        $tpl += '</li>';
    }
    $tpl += '</ul>';
    $tpl += '</li>';
    $('.graph-imgs-container').append($tpl);
    initialize_graph_sorting();
}

function lazy_check() {
    if ($('#graph-caching-checkbox').attr('checked')) {
        $('.toload.gc-img').each(function () {
            window_top = $(window).height() + $(window).scrollTop();
            var elem_top = $(this).offset().top;
            if ((window_top > elem_top) && (elem_top !== 0)) {
                show_lazy_graph(this);
                $(this).removeClass('toload');
            }

        });
    }
}

/**
 * check which container anchor is clicked and load the apropiate container
 *
 * @param {Object}
 *            url
 */
var load_url = function () {
    var url = $(this).attr('href');
    var place = '#plugins';
    if (get_container(this) == 'hosts-container') {
        $('#hosts a').each(function () {
            $(this).removeClass('selected');
        });
        $selected_host = $(this).html();
        $.getJSON('cgi-bin/collection.modified.cgi?action=pluginlist_json&host=' + $selected_host, function (data) {
            $("#plugins").html('');
            $("#plugins").append(create_plugin_menu($selected_host, data));

            $('#plugins ul li a').click(function () {
                $('#plugins').data('selected_plugin', $(this).attr('rel'));
            });
        });
    } else {
        $selected_plugin = $(this).html();
        $(".graph-imgs-container").html('');
        $.getJSON('cgi-bin/collection.modified.cgi?action=graphs_json;plugin=' + $selected_plugin + ';host=' + $selected_host, function (data) {
            $graph_json = data;
            create_graph_list("day", data.day);
            $('#graph-container').html(get_graph_main_container($selected_host));

            lazy_check();
        });
    }


    $('#plugins a').each(function () {
        $(this).removeClass('selected');
    });

    $(this).addClass('selected');

    return false;
};

$(document).ready(function () {

    $('#menu-tabs').tabs();
    $('button').not('.toolbar-button').button();

    restore_graph_view();
    restore_cpu_idle_visibility();
    initialize_graph_fonts();
    $('#show-cpu-idle-checkbox').change(function () {
        set_cpu_idle_visibility(this.checked);
    });
    $('#view-container input[name="page-width"]').change(function () {
        if (this.checked) {
            graph_view_preferences.width = this.value;
            set_graph_view(true);
        }
    });
    $('#view-container input[name="graph-view"]').change(function () {
        if (this.checked) {
            graph_view_preferences.layout = this.value;
            set_graph_view(true);
        }
    });
    $('#graph-columns').change(function () {
        var columns = parseInt(this.value, 10);
        if (columns === 2 || columns === 4 || columns === 8) {
            graph_view_preferences.columns = columns;
            graph_view_preferences.layout = 'grid';
            set_graph_view(true);
        }
    });
    var view_resize_timer;
    $(window).resize(function () {
        window.clearTimeout(view_resize_timer);
        view_resize_timer = window.setTimeout(function () { set_graph_view(false); }, 100);
    });

    $.ajaxSetup({ cache: true });

    $("#loading").ajaxStart(function () { $(this).show(); });

    $("#loading").ajaxStop(function () {
        $(this).hide();
        initialize_graph_sorting();
    });

    $.getJSON('cgi-bin/collection.modified.cgi?action=hostlist_json', function (data) {
        for (i = 0; i < data.length; i++) {
            $("#hosts ul").append('<li><a href="cgi-bin/collection.modified.cgi?action=show_host;host=' + data[i] + '">'
                + data[i] + '</a></li>');
        }
    });

    $('.ttip').hover(function () {
                        var text = $(this).find('div.ttip-content').html();
                        $('#help-box').html(text).fadeIn();
                    },
                     function () {
                        $('#help-box').html('').hide();
                    });

    // set local and server time
    $("#clock").jclock();

    $.getJSON('cgi-bin/time.cgi', function (data) {
        server_tz = parseInt(data.tz, 10);
        $("#clock-server").jclock({
            utc: true,
            utcOffset: server_tz
        });

    });

    $("#clock-server-slider").slider({
        min: -12,
        max: 12,
        step: 0.5,
        change: function (event, ui) {
            $('#clock-server-gmt').html(get_gmt(ui.value));
        }
    });

    $('#clock-server-add').submit(function () {
        var offset = parseInt($('#clock-server-gmt').html(), 10);
        var new_span = $(document.createElement("span"));
        var new_li = $(document.createElement("li"));
        new_span.jclock({
            format: '%H:%M',
            utc: true,
            utcOffset: offset
        });
        $(new_span).appendTo(new_li);
        new_li.append(' ' + $('#clock-server-add-label').val());
        $(new_li).appendTo('#new-clock-container');
        return false;
    });


    $('#show-ruler-checkbox').click(function () {
        if ($(this).attr('checked')) {
            $('#ruler').fadeIn();
        } else {
            $('#ruler').fadeOut();
        }
    });

    $('#ruler').draggable({
        axis: 'x'
    });

    $('#hosts a, #plugins a').live('click', load_url);

    $('#select-all').live('click', function () {
        $('.selectable').addClass('selected');
        return false;
    });

    $('#select-none').live('click', function () {
        $('.selectable').removeClass('selected');
        return false;
    });

    $("#slide-menu-container .ui-widget-header").click(function () {
        $("#slide-menu-container .ui-widget-content").slideToggle("fast");
        $(this).toggleClass("active");
        return false;
    });

    $('.icons, .fg-button').livequery(function () {
        $(this).each(function () {
            $(this).hover(function () {
                $(this).addClass('ui-state-hover');
            }, function () {
                $(this).removeClass('ui-state-hover');
            });
        });
    });

    $("#host-filter").live('keyup', function () {
        var searchText = $(this).val();
        $("#hosts li").hide();
        if (searchText === "") {
            $("#hosts li").show();
        } else {
            $("#hosts li:contains(" + searchText + ")").show();
        }

        $(this).focus();
    });

    $('#hosts a, #plugins a').live('click', function () {
        $(this).addClass("selected");
    });

    if ($('#graph-caching-checkbox').attr('checked')) {
        $(window).scroll(function () {
            lazy_check();
        });
    }

    $('#rrdeditor-form').submit(function () {
        $('#timespan-menu').data('start',$('.timespan-from').val());
        $('#timespan-menu').data('end', $('.timespan-to').val());

        var start_date = Date.parseExact($('.timespan-from').val(), "yyyy-MM-ddTHH:mm");
        var end_date   = Date.parseExact($('.timespan-to').val(),   "yyyy-MM-ddTHH:mm");

        if (!start_date || !end_date) {
            $('#error-msg').data('msg', 'One of the dates is invalid');
            $('#error-msg').dialog("open");
        } else {
            update_all_graphs(start_date, end_date);
        }

        return false;
    });

    $('#error-msg').dialog({
        modal:true,
        autoOpen:false,
        resizable:false,
        draggable:false,
        title: "An error has ocurred",
        open: function(event, ui) {
            $('#error-msg .content').html($('#error-msg').data('msg'));
        },
        buttons:{Ok: function(){$(this).dialog( "close" );}}
    });

    $('.rrdeditor-reset').click(function () {
        //FIXME need to reset values
        update_graphs();

        return false;
    });

    $('#load-graphdefs').click(
    function () {
        $.getJSON('cgi-bin/graphdefs.cgi', function (data) {
            graph_def_values = data.graph_defs;
            for (var def in graph_def_values) {
                $('#graphdef-name').append('<option value="' + def + '">' + def + '</option>');
            }
        });
    });

    $('#graphdef-name').change(function () {
        var gdef = $(this).val();
        var values = graph_def_values[gdef];
        $('#graphdef-content').val(values.join('\n'));
    });

    //action trigger when any toolbar menu option is clicked
    $('.menu-options .toolbar-button').click(function() {
        show_toolbar_panel(this.id);
    });

    $('#toolbar-home').click(function() {
        show_toolbar_panel('menu-options');
    });

    $('.ts-item').click(function() {
        var timespan = $(this).attr('title');
        if (!$graph_json || !$graph_json[timespan]) {
            return;
        }

        var end_date = server_now();
        var start_date = get_timespan_start(timespan);

        update_all_graphs(start_date, end_date);

        if (!$("li.graph-image").hasClass(timespan)) {
            create_graph_list(timespan, $graph_json[timespan]);
        }

        $("li.graph-image").hide();
        $("li.graph-image." + timespan).show();
        lazy_check();
    });

    initialize_toolbar();
});

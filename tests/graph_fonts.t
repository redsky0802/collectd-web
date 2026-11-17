use strict;
use warnings;
no warnings 'once';
use utf8;
use Test::More;
use File::Temp qw(tempdir);
use FindBin;
use Encode qw(encode_utf8);

open my $fh, '<', "$FindBin::Bin/../cgi-bin/collection.modified.cgi" or die $!;
my $source = do { local $/; <$fh> };
close $fh;
$source =~ s/exit\( main\(\) \);/1;/ or die 'CGI entry point not found';
eval "package GraphFontTest;\n$source";
die $@ if $@;
my @defaults = @GraphFontTest::RRDDefaultArgs;

sub query {
    CGI::delete_all();
    my %params = @_;
    CGI::param(-name => $_, -value => $params{$_}) for keys %params;
}

sub font_options {
    query(@_);
    @GraphFontTest::RRDDefaultArgs = @defaults;
    GraphFontTest::apply_graph_font_options();
    my (%fonts, $mode);
    my @args = @GraphFontTest::RRDDefaultArgs;
    for (my $i = 0; $i < @args; $i++) {
        if ($args[$i] eq '--font') {
            my ($tag, $size, $family) = split /:/, $args[++$i], 3;
            $fonts{$tag} = [$size, $family];
        } elsif ($args[$i] eq '--font-render-mode') {
            $mode = $args[++$i];
        }
    }
    return (\%fonts, $mode);
}

my ($fonts, $mode) = font_options();
is_deeply($fonts->{DEFAULT}, [0, 'monospace,'], 'default family preserves sizes');
is_deeply($fonts->{TITLE}, [14, 'Monospace'], 'original title size is retained');
is_deeply($fonts->{AXIS}, [10, 'Monospace'], 'original axis size is retained');
ok(!defined $mode, 'absent mode keeps server configuration');
for my $render (qw(normal light mono)) {
    (undef, $mode) = font_options(font_render_mode => $render);
    is($mode, $render, "$render is passed to RRDtool");
}

my %settings = (font_default => 'Liberation Mono', font_default_size => '11.5',
                font_render_mode => 'light');
for my $tag (qw(title axis unit legend watermark)) {
    $settings{"font_$tag"} = encode_utf8('测试字体 2');
    $settings{"font_" . $tag . "_size"} = '16';
}
($fonts, $mode) = font_options(%settings);
is_deeply($fonts->{DEFAULT}, ['11.5', 'Liberation Mono,'], 'DEFAULT applied first');
for my $tag (qw(TITLE AXIS UNIT LEGEND WATERMARK)) {
    is_deeply($fonts->{$tag}, [16, '测试字体 2,'], "$tag accepts a UTF-8 family and size");
}
($fonts) = font_options(font_title_size => 18);
is_deeply($fonts->{TITLE}, [18, ''], 'size-only override inherits family');
($fonts) = font_options(font_title => 'DejaVu Sans');
is_deeply($fonts->{TITLE}, [0, 'DejaVu Sans,'], 'family-only override keeps size');
is(GraphFontTest::graph_font_family('  A & B  '), 'A & B', 'spaces trimmed, ampersand retained');
for my $family ("bad\nname", 'bad:name', '/etc/passwd', 'x;--zoom=100', 'x' x 129, "\xff") {
    is(GraphFontTest::graph_font_family($family), '', 'invalid family rejected');
}
for my $size ('-1', '73', '1e2', '8:bad', '12.345', '', 'NaN') {
    is(GraphFontTest::graph_font_size($size), 0, "invalid size $size ignored");
}
is(GraphFontTest::graph_font_size('5.25'), 5.25, 'fractional sizes supported');
(undef, $mode) = font_options(font_render_mode => 'light;--zoom=100');
ok(!defined $mode, 'invalid rendering mode ignored');

for my $columns (20, 60, 80, 200) {
    query(title_columns => $columns);
    my $text = '设备_' . ('serial_123456789_' x 30);
    my @lines = GraphFontTest::graph_title_lines(encode_utf8($text));
    is(join('', @lines), $text, "$columns-column wrapping preserves identity");
    my $fits = 1;
    for my $line (@lines) {
        my $width = 0;
        $width += /[^\x00-\x7f]/ ? 2 : 1 for $line =~ /\X/g;
        $fits = 0 if $width > $columns;
    }
    ok($fits, "all lines fit $columns columns");
}
for my $columns ('0', '19', '201', '40.5', '-20', '1e2', '') {
    query(title_columns => $columns);
    is(GraphFontTest::graph_title_columns(), 80, 'invalid wrapping falls back to 80');
}
query(title_columns => 20);
my ($title, $notes) = GraphFontTest::graph_title_layout(
    GraphFontTest::graph_display_title('host', 'disk', 'serial_' x 40, 'disk_time', undef));
is(scalar(split /\n/, $title), 3, 'custom wrap keeps RRDtool title-line safeguard');
ok(@$notes > 1, 'complete long title remains in notes');

my $temp = tempdir(CLEANUP => 1);
sub mock_fc_list {
    my ($body) = @_;
    open my $script, '>', "$temp/fc-list" or die $!;
    print {$script} "#!$^X\n$body\n";
    close $script;
    chmod 0755, "$temp/fc-list" or die $!;
}
{
    local $ENV{PATH} = $temp;
    mock_fc_list('print "Zed\nA & B\nZed\nmonospace\nbad:name\n";');
    my $catalog = GraphFontTest::server_font_families();
    ok($catalog->{available}, 'font enumeration succeeds');
    is_deeply($catalog->{fonts}, ['monospace', 'A & B', 'Zed'],
              'catalog deduplicates, validates and includes monospace');
    mock_fc_list('exit 1;');
    $catalog = GraphFontTest::server_font_families();
    ok(!$catalog->{available}, 'failed enumeration reported');
    is_deeply($catalog->{fonts}, ['monospace'], 'failure falls back to monospace');
    mock_fc_list('sleep 10;');
    my $start = time;
    $catalog = GraphFontTest::server_font_families();
    ok(!$catalog->{available} && time - $start < 8, 'slow enumeration times out');
    unlink "$temp/fc-list";
    local $SIG{__WARN__} = sub {};
    $catalog = GraphFontTest::server_font_families();
    is_deeply($catalog->{fonts}, ['monospace'], 'missing fc-list remains usable');
}

query(font_default => 'Liberation Sans', font_title_size => 18,
      font_render_mode => 'mono', theme => 'dark');
GraphFontTest::load_graph_definitions();
GraphFontTest::apply_graph_font_options();
my $args = join "\n", @GraphFontTest::RRDDefaultArgs;
like($args, qr/BACK#222222FF/, 'dark theme colors retained');
like($args, qr/DEFAULT:0:Liberation Sans,/, 'font override follows dark defaults');
like($args, qr/--font-render-mode\nmono/, 'rendering mode applies in dark theme');
query();
done_testing();

use strict;
use warnings;
no warnings 'once';
use utf8;
use Test::More;
use File::Temp qw(tempdir);
use File::Path qw(make_path);
use FindBin;
use JSON qw(from_json);
use URI::Escape qw(uri_unescape);

open my $fh, '<', "$FindBin::Bin/../cgi-bin/collection.modified.cgi" or die $!;
my $source = do { local $/; <$fh> };
close $fh;
$source =~ s/exit\( main\(\) \);/1;/ or die 'CGI entry point not found';
eval "package NaturalSortTest;\n$source";
die $@ if $@;
# The existing HTML entry point uses param() in list context.
local $CGI::LIST_CONTEXT_WARN = 0;

my @cases = (
    ['CPU IDs', [qw(10 1 100 2 20 0 11)], [qw(0 1 2 10 11 20 100)]],
    ['interfaces', [qw(eth10 eth2 eth1)], [qw(eth1 eth2 eth10)]],
    ['PCI names', [qw(enp10s0 enp2s10 enp2s2 enp2s0)],
        [qw(enp2s0 enp2s2 enp2s10 enp10s0)]],
    ['NVMe names', [qw(nvme1n1 nvme0n10 nvme0n2 nvme0n1)],
        [qw(nvme0n1 nvme0n2 nvme0n10 nvme1n1)]],
    ['sensor names', [qw(temp10 temp2 temp1)], [qw(temp1 temp2 temp10)]],
    ['host names', [qw(node10 node2 node1)], [qw(node1 node2 node10)]],
    ['leading-zero tie', [qw(eth2 eth02 eth002)], [qw(eth002 eth02 eth2)]],
    ['later runs before tie-break', [qw(enp2s10 enp02s2 enp2s2)],
        [qw(enp02s2 enp2s2 enp2s10)]],
    ['punctuation', [qw(eth0.10 eth0.2 eth-1 eth2 eth)],
        [qw(eth eth-1 eth0.2 eth0.10 eth2)]],
    ['case-sensitive text', [qw(eth1 Eth10 Eth2)], [qw(Eth2 Eth10 eth1)]],
    ['zero runs and empty labels', ['', '000', '0', '-', '00', 'all'],
        ['', '-', '0', '00', '000', 'all']],
    ['non-ASCII text', ['温度10', '温度2', '温度1'],
        ['温度1', '温度2', '温度10']],
    ['large adjacent IDs', [qw(id18446744073709551617 id18446744073709551616)],
        [qw(id18446744073709551616 id18446744073709551617)]],
    ['long numeric runs', ['disk1' . ('0' x 90), 'disk' . ('9' x 90)],
        ['disk' . ('9' x 90), 'disk1' . ('0' x 90)]],
    ['duplicates', [qw(cpu2 cpu10 cpu2 cpu1)], [qw(cpu1 cpu2 cpu2 cpu10)]],
);
for my $case (@cases) {
    my ($name, $input, $expected) = @$case;
    is_deeply([NaturalSortTest::_natural_sort(@$input)], $expected, $name);
    is_deeply([NaturalSortTest::_natural_sort(reverse @$input)], $expected,
              "$name is independent of input order");
}
my @plain = qw(zeta alpha Alpha br-lo uplink lo wg vpn);
is_deeply([NaturalSortTest::_natural_sort(@plain)], [sort @plain],
          'text-only names retain the original ordering');
is_deeply([NaturalSortTest::_natural_sort(reverse 0..255)], [map { "$_" } 0..255],
          '256 logical CPU IDs sort numerically');

# Check total-order properties on a mixed set, including the cases in which
# an early leading-zero tie-break can disagree with a later numeric run.
my %unique = map { $_ => 1 } map { @{$_->[1]} } @cases;
my @values = keys %unique;
my @ordered = NaturalSortTest::_natural_sort(@values);
my ($antisymmetric, $consistent) = (1, 1);
for my $i (0..$#ordered) {
    for my $j (0..$#ordered) {
        my $ab = NaturalSortTest::_natural_cmp($ordered[$i], $ordered[$j]);
        my $ba = NaturalSortTest::_natural_cmp($ordered[$j], $ordered[$i]);
        $antisymmetric = 0 if ($ab <=> 0) != -($ba <=> 0);
        $consistent = 0 if ($i <=> $j) != ($ab <=> 0);
    }
}
ok($antisymmetric, 'mixed comparisons are antisymmetric');
ok($consistent, 'every pair agrees with the complete sorted order');

# Exercise the real filesystem discovery and both listing entry points.
# These are placeholder RRD filenames: listing graphs must not read or alter
# the underlying time-series data.
my $temp = tempdir(CLEANUP => 1);
sub fixture {
    my ($host, $plugin, $file) = @_;
    my $directory = "$temp/$host/$plugin";
    make_path($directory);
    open my $out, '>', "$directory/$file.rrd" or die $!;
    print {$out} "listing fixture\n";
    close $out;
}
for my $host (qw(node10 node2)) {
    fixture($host, 'interface-eth0', 'if_octets');
}
my @cpu_ids = qw(0 1 2 10 11 20 100);
for my $id (reverse @cpu_ids) {
    fixture('node1', "cpu-$id", 'cpu-user');
    fixture('node1', "cpu-$id", 'cpu-idle');
}
fixture('node1', 'cpu', 'cpu-idle');
my @interfaces = qw(enp2s2 enp2s10 enp10s0 eth0.2 eth0.10 eth02 eth2 eth10);
fixture('node1', "interface-$_", 'if_octets') for reverse @interfaces;
my @disks = qw(nvme0n1 nvme0n2 nvme0n10 nvme1n1);
fixture('node1', "disk-$_", 'disk_time') for reverse @disks;
for my $chip (qw(chip10 chip2)) {
    fixture('node1', "sensors-$chip", "temperature-$_") for qw(temp10 temp2);
}
for my $plugin (qw(plugin10 plugin2)) {
    fixture('node1', $plugin, 'temperature');
}
for my $type (qw(metric10 metric2)) {
    fixture('node1', 'custom-device2', "$type-value10");
    fixture('node1', 'custom-device2', "$type-value2");
}
@NaturalSortTest::DataDirs = ($temp);

sub query {
    CGI::delete_all();
    CGI::param(-name => 'host', -value => 'node1');
    CGI::param(-name => 'plugin', -value => $_[0]) if @_;
}
sub capture {
    my ($code) = @_;
    my $output = '';
    open my $out, '>', \$output or die $!;
    local *STDOUT = $out;
    $code->();
    return $output;
}
sub json_output {
    my ($code) = @_;
    my $output = capture($code);
    $output =~ s/\A.*?\r?\n\r?\n//s or die 'Missing CGI headers';
    return from_json($output);
}
sub graph_params {
    my ($url) = @_;
    $url =~ s/^.*?\?//;
    return { map {
        my ($name, $value) = split /=/, $_, 2;
        $name => uri_unescape($value // '');
    } split /;/, $url };
}
sub html_day_urls {
    my ($html) = @_;
    my @urls = $html =~ /<img src="([^"]+)"/g;
    return [grep { /;timespan=day\z/ } @urls];
}

query();
is_deeply(json_output(\&NaturalSortTest::list_hosts_json), [qw(node1 node2 node10)],
          'host JSON uses natural order');
my @plugins = qw(cpu custom disk interface plugin2 plugin10 sensors);
is_deeply(json_output(\&NaturalSortTest::action_show_host_json), \@plugins,
          'plugin JSON uses natural order');
my $host_html = capture(\&NaturalSortTest::action_show_host);
my @html_plugins = $host_html =~ /<a href="[^"]+">([^<]+)<\/a>/g;
is_deeply(\@html_plugins, \@plugins, 'HTML plugin list matches JSON');

for my $case (
    [cpu => ['', @cpu_ids]],
    [interface => \@interfaces],
    [disk => \@disks],
) {
    my ($plugin, $expected) = @$case;
    query($plugin);
    my $json = json_output(\&NaturalSortTest::action_show_plugin_json);
    for my $timespan (qw(hour day week month year decade)) {
        is_deeply([map { graph_params($_)->{plugin_instance} // '' } @{$json->{$timespan}}],
                  $expected, "$plugin instances ordered in $timespan JSON");
    }
    my $html = capture(\&NaturalSortTest::action_show_plugin);
    is_deeply(html_day_urls($html), $json->{day}, "$plugin HTML and JSON agree");
}
query('sensors');
my $sensors = json_output(\&NaturalSortTest::action_show_plugin_json);
is_deeply([map { my $p = graph_params($_);
                "$p->{plugin_instance}/$p->{type_instance}" } @{$sensors->{day}}],
          [qw(chip2/temp2 chip2/temp10 chip10/temp2 chip10/temp10)],
          'plugin and type instances both use natural order');
is_deeply(html_day_urls(capture(\&NaturalSortTest::action_show_plugin)), $sensors->{day},
          'sensor HTML and JSON agree');
query('custom');
my $custom = json_output(\&NaturalSortTest::action_show_plugin_json);
is_deeply([map { my $p = graph_params($_); "$p->{type}/$p->{type_instance}" }
               @{$custom->{day}}],
          [qw(metric2/value2 metric2/value10 metric10/value2 metric10/value10)],
          'type names and their instances both use natural order');
is_deeply(html_day_urls(capture(\&NaturalSortTest::action_show_plugin)), $custom->{day},
          'custom type HTML and JSON agree');

query();
CGI::param(-name => 'plugin', -value => ['plugin10', 'plugin2']);
my $selected = html_day_urls(capture(\&NaturalSortTest::action_show_plugin));
is_deeply([map { graph_params($_)->{plugin} } @$selected], [qw(plugin2 plugin10)],
          'legacy HTML selection orders multiple plugins naturally');

# Graph series have semantic order and must not be sorted as browse labels.
my @cpu = qw(steal interrupt softirq system wait user nice idle);
my @cpu_order = qw(idle nice user wait system softirq interrupt steal);
NaturalSortTest::_custom_sort_arrayref(\@cpu, \@cpu_order);
is_deeply(\@cpu, \@cpu_order, 'CPU state order is retained');
my @memory = qw(used free buffered cached);
NaturalSortTest::_custom_sort_arrayref(\@memory, [qw(free cached buffered used)]);
is_deeply(\@memory, [qw(free cached buffered used)], 'memory state order is retained');
my @unknown = qw(state2 idle state10);
NaturalSortTest::_custom_sort_arrayref(\@unknown, ['idle']);
is_deeply(\@unknown, [qw(idle state10 state2)], 'existing series fallback is retained');
done_testing();

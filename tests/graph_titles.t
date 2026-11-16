use strict;
use warnings;
no warnings 'once';
use utf8;
use Test::More;
use File::Temp qw(tempdir);
use File::Path qw(make_path);
use Cwd qw(abs_path getcwd);
use FindBin;
use Encode qw(encode_utf8);

# Load the legacy CGI without running its HTTP/configuration entry point.
my $source_file = "$FindBin::Bin/../cgi-bin/collection.modified.cgi";
open my $fh, '<', $source_file or die "$source_file: $!";
my $source = do { local $/; <$fh> };
close $fh;
$source =~ s/exit\( main\(\) \);/1;/ or die 'CGI entry point not found';
eval "package GraphTitleTest;\n$source";
die $@ if $@;

my $host = 'RedSky-Debian.lan';
my @cases = (
    [cpu => '0', 'cpu', undef, 'cpu[0]'],
    [df => 'boot-efi', 'df_complex', undef, 'df[boot-efi] / df_complex'],
    [memory => undef, 'memory', undef, 'memory'],
    [swap => undef, 'swap', undef, 'swap'],
    [swap => undef, 'swap_io', 'in', 'swap / swap_io[in]'],
    [swap => undef, 'swap_io', 'out', 'swap / swap_io[out]'],
    [interface => 'br0', 'if_dropped', undef, 'interface[br0] / if_dropped'],
    [load => undef, 'load', undef, 'load'],
    [sensors => 'nvme-pci-0100', 'temperature', 'temperature',
        'sensors[nvme-pci-0100] / temperature'],
    [sensors => 'it8628-isa-0a40', 'temperature', 'temp1',
        'sensors[it8628-isa-0a40] / temperature[temp1]'],
    [example => '0', 'gauge', '0', 'example[0] / gauge[0]'],
    [memory => '', 'memory', '', 'memory'],
);
for my $case (@cases) {
    my ($plugin, $pinst, $type, $tinst, $expected) = @$case;
    is(GraphTitleTest::graph_display_title($host, $plugin, $pinst, $type, $tinst),
        "$host\n$expected", $expected);
}

for my $text ('X' x 240, 'nvme_INTEL_' . ('serial_' x 25) . 'ns1',
              '温度传感器' x 30, "e\x{301}" x 100) {
    my @lines = GraphTitleTest::graph_title_lines(encode_utf8($text));
    is(join('', @lines), $text, 'wrapping preserves the complete UTF-8 label');
    ok(@lines > 1, 'long label is wrapped');
    ok(!grep(length($_) > 80, @lines), 'lines fit the title budget');
}

my $long_title = GraphTitleTest::graph_display_title(
    $host, 'disk', 'nvme_' . ('serial_' x 30), 'disk_io_time', undef);
my ($render_title, $notes) = GraphTitleTest::graph_title_layout($long_title);
is(scalar(split(/\n/, $render_title)), 3, 'RRDtool title never exceeds three lines');
like($render_title, qr/\[\.\.\.\]/, 'omission is explicit');
like($render_title, qr/disk_io_time\z/, 'metric remains visible');
is_deeply($notes, ['COMMENT:Full title\\l', map { "COMMENT:$_\\l" } split(/\n/, $long_title)],
    'full identity is retained below the legend in every export format');
my ($short_title, $no_notes) = GraphTitleTest::graph_title_layout("$host\ncpu[0]");
is_deeply($no_notes, [], 'short titles need no repeated identity');

my $temp = tempdir(CLEANUP => 1);
my $cwd = getcwd();
my @commands;
{
    no warnings 'redefine';
    local *RRDs::graph = sub { push @commands, [@_]; return; };
    local *RRDs::error = sub { return; };
    local @GraphTitleTest::DataDirs = ($temp);
    local $GraphTitleTest::OutputFormat = 'SVG';

    # Each specialized stack builder must carry the same display fields while
    # retaining its original source paths, including CPU instance zero.
    my @graphs = (
        [cpu => '0', 'cpu', undef, [qw(idle user)], 'cpu[0]'],
        [df => 'boot-efi', 'df_complex', undef, [qw(free used)],
            'df[boot-efi] / df_complex'],
        [dns => undef, 'num_opcode', undef, [qw(Query Notify)], 'dns / num_opcode'],
        [memory => undef, 'memory', undef, [qw(free used)], 'memory'],
        [interface => 'br0', 'if_rx_errors', undef, [qw(crc frame)],
            'interface[br0] / if_rx_errors'],
        [mysql => undef, 'mysql_commands', undef, [qw(select insert)],
            'mysql / mysql_commands'],
        [nfs => 'v3client', 'nfs_procedure', undef, [qw(read write)],
            'nfs[v3client] / nfs_procedure'],
        [pkg => undef, 'pkg', undef, [qw(built failed)], 'pkg'],
        [processes => undef, 'ps_state', undef, [qw(running sleeping)],
            'processes / ps_state'],
        [swap => undef, 'swap', undef, [qw(free used)], 'swap'],
        [tcpconns => '22-local', 'tcp_connections', undef,
            [qw(ESTABLISHED LISTEN)], 'tcpconns[22-local] / tcp_connections'],
        [vmem => undef, 'vmpage_number', undef, [qw(dirty mapped)],
            'vmem / vmpage_number'],
        [vmem => undef, 'vmpage_action', undef, [qw(activate deactivate)],
            'vmem / vmpage_action'],
        [load => undef, 'load', undef, [], 'load'],
        [swap => undef, 'swap_io', 'in', [], 'swap / swap_io[in]'],
        [interface => 'br0', 'if_dropped', undef, [], 'interface[br0] / if_dropped'],
        [sensors => 'nvme-pci-0100', 'temperature', 'temperature', [],
            'sensors[nvme-pci-0100] / temperature'],
        [redis => undef, 'memory', undef, [], 'redis / memory'],
    );
    if (exists $GraphTitleTest::GraphDefs->{'smart_temperature'}) {
        push @graphs, [smart => 'ata-EXAMPLE_serial', 'smart_temperature', undef,
            [], 'smart[ata-EXAMPLE_serial] / smart_temperature'];
    }
    for my $theme ('light', 'dark') {
        CGI::param(-name => 'theme', -value => $theme);
        GraphTitleTest::load_graph_definitions();
        for my $fixed (0, 1) {
            local $GraphTitleTest::Args = { timespan => 'day' };
            if ($fixed) {
                $GraphTitleTest::Args->{start} = 1700000000;
                $GraphTitleTest::Args->{end} = 1700003600;
            }
            for my $graph (@graphs) {
                my ($plugin, $pinst, $type, $tinst, $instances, $detail) = @$graph;
                my $dir = "$host/$plugin" . (defined($pinst) ? "-$pinst" : '');
                make_path("$temp/$dir");
                my @files = map {
                    "$dir/$type" . (defined($_) ? "-$_" : '') . '.rrd'
                } (@$instances ? @$instances : ($tinst));
                for my $file (@files) {
                    open my $rrd, '>', "$temp/$file" or die $!;
                    close $rrd;
                }
                @commands = ();
                GraphTitleTest::action_show_graph($host, $plugin, $pinst, $type, $tinst);
                is(scalar @commands, 1, "$theme/$fixed: $detail renders once");
                my @cmd = @{$commands[0]};
                my ($title) = map { $cmd[$_ + 1] } grep { $cmd[$_] eq '-t' } 0..$#cmd;
                is($title, "$host\n$detail", 'ordinary and stacked titles agree');
                ok(grep($_ eq 'TITLE:14:Monospace', @cmd), 'consistent title font');
                my ($format) = map { $cmd[$_ + 1] } grep { $cmd[$_] eq '-a' } 0..$#cmd;
                is($format, 'SVG', 'SVG output is retained');
                my @defs = grep /^DEF:/, @cmd;
                for my $file (@files) {
                    ok(grep(index($_, "=$file:") >= 0, @defs), "unchanged RRD path: $file");
                }
                ok(!grep(/\n/, @defs), 'display newlines never enter RRD paths');
            }
        }
    }
}
chdir $cwd or die $!;
CGI::delete_all();
GraphTitleTest::_get_format_param();
is($GraphTitleTest::OutputFormat, 'SVG', 'default output format remains SVG');
done_testing();

using Mdpkg.Core;
using Mdpkg.EngineTests;
using Mdpkg.Tests;

namespace Mdpkg.ApiTests;

public class MalformedHistoryTests
{
    public static IEnumerable<object[]> Cases => MalformedHistoryFixture.Cases;

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task NullHistoryRecordsReturnNonconformingThroughFileAndStream(string field, string position, bool deep)
    {
        using var fixture = new EngineFixture();
        MalformedHistoryFixture.Write(fixture.Output, field, position);
        var bytes = File.ReadAllBytes(fixture.Output);
        var validator = new Core.PackageValidator();
        var options = new ValidationOptions { Deep = deep };
        var file = await validator.ValidateFileAsync(fixture.Output, options, TestContext.Current.CancellationToken);
        using var input = new MemoryStream(bytes);
        var stream = await validator.ValidateAsync(input, options, TestContext.Current.CancellationToken);
        Assert.True(input.CanRead); Assert.Equal(bytes, File.ReadAllBytes(fixture.Output));
        Assert.Equal(file.Diagnostics, stream.Diagnostics); Assert.Equal(file.Checks, stream.Checks);
        foreach (var result in new[] { file, stream })
        {
            Assert.Equal(OperationStatus.Nonconforming, result.Status); Assert.False(result.IsConforming);
            Assert.Null(result.Package); Assert.NotNull(result.Manifest);
            var expected = MalformedHistoryFixture.Diagnostic(field);
            var diagnostic = Assert.Single(result.Diagnostics);
            Assert.Equal(expected.Code, diagnostic.Code); Assert.Equal(expected.Message, diagnostic.Message);
            Assert.Equal(expected.Spec, diagnostic.Spec); Assert.Equal(DiagnosticSeverity.Error, diagnostic.Severity);
            Assert.Null(diagnostic.Entry);
            Assert.Contains(result.Checks, c => c.Code == expected.Code && c.Status == CheckStatus.Failed);
            Assert.Equal(CheckStatus.Skipped, result.Checks[16].Status); Assert.Equal(CheckStatus.Skipped, result.Checks[17].Status);
            var history = Assert.IsType<HistoryMetadata>(result.History);
            Assert.Equal(1, history.RetainedCommits);
            var retained = position == "only" ? 0 : 1;
            foreach (var name in field == "all" ? MalformedHistoryFixture.Fields : [field])
            {
                Assert.Equal(retained, name switch
                {
                    "transformations" => history.Transformations.Count, "patches" => history.Patches.Count,
                    "addressingCoverage" => history.AddressingCoverage.Count, "ranges" => history.Ranges.Count,
                    _ => history.ShallowBoundaries.Count
                });
            }
            Assert.All(history.Transformations, Assert.NotNull); Assert.All(history.Patches, Assert.NotNull);
            Assert.All(history.AddressingCoverage, Assert.NotNull); Assert.All(history.Ranges, Assert.NotNull);
            Assert.All(history.ShallowBoundaries, Assert.NotNull);
            Assert.Throws<NotSupportedException>(() => ((IList<TransformationMetadata>)history.Transformations).Clear());
        }
    }
}

namespace Mdpkg.Cli;

/// <summary>
/// Process exit codes, docs/spec/generator-cli.md §3. The spec defines 0–5; every other value is a tool artefact.
/// </summary>
public enum ExitCode
{
    /// <summary>Success. A writing verb produced a package that passes §4's validator checks against itself (§4).</summary>
    Success = 0,

    /// <summary>Usage: unknown option, missing argument, malformed UUID or qualified ID (§2).</summary>
    Usage = 1,

    /// <summary>Source rejected: a producer requirement on the input tree cannot be met (§3.6).</summary>
    SourceRejected = 2,

    /// <summary>Package nonconforming: <c>validate</c> failed, or an input package failed its entry checks (§3.7, §4).</summary>
    Nonconforming = 3,

    /// <summary>Producer obligation unmet: correspondence could not be confirmed and <c>--require-complete</c> was given (§6.3).</summary>
    ObligationUnmet = 4,

    /// <summary>Environment: <c>git</c> absent or failing, IO error, output path unwritable (§5.1).</summary>
    Environment = 5,

    /// <summary>
    /// Scaffold only, not in §3: the verb parsed and validated but has no implementation yet.
    /// 70 is sysexits EX_SOFTWARE. Removed together with the last stub.
    /// </summary>
    NotImplemented = 70,
}

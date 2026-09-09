# Independent CommonMark inventory fixture

`commonmark-0.31.2.json` contains the examples from the
[CommonMark 0.31.2 specification](https://spec.commonmark.org/0.31.2/),
Copyright © 2014–2016 John MacFarlane, licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
The derived fixture is distributed under that same license. Changes: rendered HTML
and line metadata are replaced with mdpkg locators, roots and scoped-source digests
computed independently by the repository's JavaScript viewer (commonmark.js 0.31.2).

To regenerate, download `https://spec.commonmark.org/0.31.2/spec.json`, run `npm ci`
in `src/web-viewer`, then run:

```text
node src/generator-cli/tests/Mdpkg.Cli.Tests/Fixtures/generate-commonmark.mjs <downloaded-spec.json>
```

Ordinary .NET tests read the checked-in fixture and require no Node, network or
fixture generation. These are addressing/source-position comparisons, not HTML
renderer tests.

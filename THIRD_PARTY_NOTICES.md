# Third-party notices

## LocalSend

Tianchuang Cloud's “Nearby Transfer” sidecar uses a vendored snapshot of the
LocalSend Rust protocol core.

- Upstream: <https://github.com/localsend/localsend>
- Copyright: LocalSend contributors
- License: Apache License 2.0
- License file: `native/vendor/localsend-core/LICENSE`

Tianchuang Cloud modifications and additions include a JSON-lines IPC process,
Electron lifecycle integration, receive approval UI, atomic `.part` staging,
safe relative-path handling, unique destination names, progress events and
dynamic server-port selection. Tianchuang Cloud is not an official LocalSend
distribution.

## Sunshine

The optional Toolbox can open the official Sunshine installer workflow. The
installer is downloaded on demand from the upstream GitHub Release; Tianchuang
Cloud does not bundle or relink Sunshine.

- Upstream: <https://github.com/SunshineStream/Sunshine>
- Copyright: Sunshine contributors
- License: GPL-3.0

## Optional Toolbox downloads

The Toolbox can download the following independent applications on demand from
their official GitHub Releases. Tianchuang Cloud validates the repository,
Windows asset name and GitHub-provided SHA-256 digest before opening or
extracting an asset. These applications are not linked into Tianchuang Cloud.

- WinIsland: <https://github.com/luolangaga/WinLand>
- Filee (MIT): <https://github.com/KnifeLemon/Filee>
- Windhawk (GPL-3.0): <https://github.com/ramensoftware/windhawk>
- Folia (AGPL-3.0): <https://github.com/chthollyphile/folia-major>
- Kazumi (GPL-3.0): <https://github.com/Predidit/Kazumi>
- Clash Verge Rev (GPL-3.0): <https://github.com/clash-verge-rev/clash-verge-rev>

## Rufus

The Toolbox aggregates an unmodified official Rufus portable executable with
the corresponding source archive and license. Rufus remains an independent
program.

- Upstream: <https://github.com/pbatard/rufus>
- Version: 4.15
- Binary: `resources/toolbox/rufus/rufus-4.15p.exe`
- Binary SHA-256: `84c8a437f8af89257524478489e5c85f1edf25f761d299e2bcde46ac0afbe106`
- Corresponding source: `resources/toolbox/rufus/rufus-4.15-source.zip`
- License: GPL-3.0

## PecoFence

The Toolbox aggregates the unmodified official PecoFence portable archive with
its Apache-2.0 license and notice. PecoFence remains an independent program.

- Upstream: <https://github.com/DayuanJiang/PecoFence>
- Version: 0.4.0
- Archive: `resources/toolbox/pecofence/pecofence-v0.4.0-x64-portable.zip`
- SHA-256: `cc985abb49bf7fc7a4f24612daa34f928c49a944ffab887b840d6d5294187385`
- License: Apache-2.0

## Pavise Game

The optional Toolbox includes an unmodified source archive as a separate
aggregate work and invokes its upstream `build.cmd` locally when the user asks
to install it. Pavise remains an independent program and requests elevation
when launched because it changes Windows scheduling and service settings.

- Upstream: <https://github.com/dulaiduwang003/Pavise-Game>
- Version: 3.3.1.1
- Source archive: `resources/toolbox/Pavise-Game-pavise3x.zip`
- SHA-256: `06414dd58e20d872620dada773a689ef68cf35776461c4a74ccd7de88a7046b1`
- License: GPL-3.0

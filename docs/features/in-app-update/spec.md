# In-app update

Status: Delivered (quiet Windows update from the version control and App Settings).
Path: `docs/features/in-app-update/spec.md`.

## Goal

Let a person who installed NeKode on Windows download the latest published release from GitHub and run its installer, starting from the version already shown in the left panel. The version text stays quiet. Nothing in the panel urges an update.

## Related requirements

- User request on 2026-10-25: the version keeps its current look, a hover lightens the text and shows a pointer, and a click opens App Settings, where the update action lives.
- User correction on 2026-10-25: the same published version is not an update, and NeKode does not close until the person has a chance to save their work.
- `docs/product/requirements.md`: the interface is English.
- `docs/features/github-releases/spec.md`: published releases, installer file names, checksums, and the rule that a draft is not a release. This contract replaces that spec's non-goal that forbade any update check in the app. A background updater stays out of scope there.
- `electron-builder.yml`: Windows artifact `NeKode-Setup-${version}.exe`. The NSIS block does not set a silent install.
- The version text is the right-hand control in `src/renderer/src/components/layout/PanelFooter.tsx`. App Settings already opens from the settings button in that footer.

## Scope

- The left-panel version control: the same text as today, a quieter hover, and a click that opens App Settings.
- A quiet update block on the General tab of App Settings.
- On a packaged Windows build, the Update action downloads the latest published Windows installer and its checksum, checks the file, starts the normal installer, and quits NeKode so the installer can replace the app and start it.
- The release-notes sentence, the README update paragraph, and `docs/operations/releases.md` change so they describe this action and still say there is no background updater.

## Non-goals

- A badge, dot, count, banner, or version comparison on the version control.
- An update check or prompt at startup, or any update UI outside App Settings.
- A background download, a scheduled check, or an automatic install.
- A silent installer switch.
- Linux AppImage replacement, macOS, or any package type other than the published Windows NSIS installer.
- Keeping terminals or agent processes alive across the quit. The post-MVP terminal host in `docs/architecture/sdd.md` section 18.2 is unchanged.
- Code signing, and publishing or moving a GitHub Release.
- Remembering a dismissed version, or a second settings window used only for update.

## Behaviour

1. The version control shows `v` plus the running app version, in the same mono, size, color, and right-hand place as today. At rest it has no border, background, icon, badge, or extra label. Its tooltip stays `NeKode v` plus that version.
2. Hover lightens the text the same way as the other footer actions (`text-ink`) and shows a pointer. Hover does not add a background. Keyboard focus uses the same focus outline as the other footer actions and does not change the resting look.
3. Activating the control opens the existing App Settings dialog on the General tab and scrolls the update block into view. The settings button still opens General as it does now and does not scroll to the update block. Escape, the backdrop, and the close control still close the dialog.
4. The update block sits at the bottom of General and uses the same label, help, and button styling as the other General rows. It shows the installed version. It does not use a warning color, an "update available" heading, or a version number inside the button label. The button label is `Update`. After the person chooses to continue, that control's label is `Close and update`.
5. When the block is shown, the app may read the latest published GitHub release once. A muted line may then show that version number. The line does not tell the person to update. If the check fails, a short error is shown and Update stays usable. The footer does not change.
6. Update is present only on a packaged Windows build, and only when a newer release was read or the release check failed. On Linux, and in an unpackaged build, the block shows the installed version and one muted line that update from this screen is only for an installed Windows build. It does not download or start a program.
7. Update downloads the latest regular published release of `tomaszmadera/NeKode`. Drafts and pre-releases are not candidates. The tag must be numeric semver without a suffix. The installer name is `NeKode-Setup-<tag>.exe`. The checksum file is `SHA256SUMS.txt` from that same release. Download addresses are built from that tag. They are not taken from an arbitrary URL in the API response.
8. The app checks the installer against the checksum line for that file name. The comparison ignores hex case. A missing line, a malformed file, or a mismatch deletes the downloaded installer and does not start it.
9. The first Update activation does not download and does not close NeKode. The block says to save work first and that NeKode closes only after the person continues. Cancel returns to the quiet Update action and starts nothing. Closing settings also starts nothing. Continuing downloads the installer, checks it, starts it as its own process with no silent-install switch, and then quits. The installer is the normal published NSIS installer. When it finishes, it starts NeKode. If the current installer config does not start the app, the config gains `runAfterFinish` and still does not become a silent install.
10. A second Update activation does nothing while a download or launch is in progress. The block shows a short progress sentence: downloading, then starting the installer. Those sentences use the muted help style.
11. When Update is offered, one muted line in the block states that Windows may show a SmartScreen warning because the installer is unsigned.
12. Update is offered only when the latest published numeric version is greater than the installed numeric version. The same version, and an older published release, show that version and a muted line that no newer release is published. They do not show Update, the SmartScreen line, or a download. Main refuses the download in that case as well. A failed check still leaves Update usable; continuing still refuses a release that is not newer.
13. Release notes stop saying that NeKode has no updater. They say that an installed Windows build can update from App Settings when a newer release is published, that Linux updates by replacing the AppImage, and that there is no background updater. The SmartScreen warning and the checksum link stay. The README and `docs/operations/releases.md` say the same, and they also say that NeKode asks you to save your work before it closes.

## Business rules

A draft is not a release. `/releases/latest` is the source of the candidate, and a suffixed tag is never installed by this action. The public repository needs no token. The downloaded installer is not kept after a failed check. It is left in the temp directory after a successful start so the installer can read it.

## Authorization

Any person using the local app may run Update. The main process refuses the install action unless the app is packaged and the host is Windows. No renderer-supplied path, URL, or version is used to choose the file.

## Data / API

- Read: `GET https://api.github.com/repos/tomaszmadera/NeKode/releases/latest` with a NeKode user agent.
- Download, only after the tag check: `https://github.com/tomaszmadera/NeKode/releases/download/<tag>/NeKode-Setup-<tag>.exe` and the `SHA256SUMS.txt` beside it. Redirects may be followed only while the host stays a GitHub release host for that repository.
- No setting is persisted. The installed version remains the build's own version.
- The renderer asks main for the latest-release summary and for the install action. Main owns the network, the checksum, the process start, and the quit.

## Edge cases

- The latest release equals the installed version, or is older: Update is absent. The app does not download or start an installer.
- The person activates Update and then cancels, or closes settings: NeKode stays open and no installer starts.
- The API omits the installer or the checksum asset: Update fails before writing an installer, or deletes a partial download, and does not start a process.
- The app is quit by the user during the download: the download stops and no installer is started.
- Dev mode and tests never start the real installer and never target an installed copy of NeKode.

## Errors

Failures stay in the update block as a short sentence. The app does not quit on a failed check, a failed download, a checksum mismatch, a missing file, or a failed process start. A raw stack is not shown. The downloaded installer is deleted when the checksum fails. There is no silent fallback to an unchecked file or to another repository.

## Acceptance criteria

1. The version control's resting text, tooltip, and placement match the current footer, with no extra visible control.
2. Hover lightens that text and shows a pointer, without a hover background.
3. Activating it opens App Settings on General and brings the update block into view. The settings button does not scroll to that block.
4. The footer never shows that a newer release exists.
5. On a packaged Windows build, when a newer release exists, Update asks the person to save their work before NeKode closes. Continuing downloads only that installer, refuses a bad checksum, starts the checked installer without a silent switch, and then quits. The same or an older release offers no Update.
6. On Linux and in an unpackaged build, the block does not download or start a program.
7. Release notes, the README, and the release runbook describe the Windows settings action and still say there is no background updater.

## Required tests

- Footer: resting text and tooltip, hover classes without a hover background, and activation opens settings.
- Settings: the block's copy, Windows packaged versus Linux and unpackaged, a muted latest version, no Update when that version is not newer, a failed check that leaves Update usable, a confirm step that does not download until the person continues, and a second click ignored while work is in progress.
- Main process, with the network and process start replaced: tag and file-name checks, constructed download URLs, checksum match and mismatch, refusal when unpackaged or not Windows, refusal when the release is not newer, and quit only after a successful start.
- Release notes: the fixed block matches behaviour 13.

## Relevant SDD / ADR

`docs/architecture/sdd.md` section 18.2. This feature quits the Electron process. It does not add the terminal host described there.
`docs/features/github-releases/spec.md`.

# Open File Backup Manager v1.0.0 scope

- Windows x64 installed desktop application. Product UI defaults to English and supports Traditional Chinese; themes are light, dark, and system.
- Named profiles contain multiple source-to-destination jobs. Profile default mode is mirror; jobs may inherit or override with mirror or copy-and-overwrite.
- Run one job, one profile, or all profiles sequentially. Cancel is available during scanning, copying, and deletion review.
- Robocopy is the sole transfer backend and provides change detection through `/L`. It is provided by Windows and never bundled or downloaded by this app. There is one direct-write path and no compatibility or staged fallback.
- The transfer indicator is indeterminate while Robocopy runs. The UI shows the active job and most recently reported file. Final copied, skipped, and transferred totals come from Robocopy's parsed summary; unknown totals remain unknown.
- Copy-and-overwrite keeps destination-only entries. Mirror removes previewed extras only after user confirmation, successful copying, source revalidation, and path-safety checks. Copy failures and cancellation block the deletion phase.
- Reject overlapping/protected paths, drive-root destinations, root links, unmatched destination links, and ambiguous Windows paths. Skip nested source links without following or recreating them; preserve matching destination entries.
- Persist settings, profiles, and one expandable Activity record per backup operation outside the installation directory. Activity includes the actual executable and complete preview, safety recheck, and transfer commands, exit code, outcome, errors, and for new runs a breakdown of active checking, Robocopy transfer, deletion, and other time; review wait is excluded. Settings exposes the actual application-data and log locations and can open them in File Explorer.
- Bind picked drive paths to Windows volume identity to tolerate drive-letter changes. Missing or reformatted media require review; no silent destination remapping.
- New installations check and download updates automatically, then require manual installation. Optional idle installation may restart the app but is blocked during backup or review. Manual check and download remain available.
- Login startup is off by default and is available only in the installed Windows app. Closing the window quits by default; an optional notification-area setting keeps it running, with Open and Quit controls. Closing remains blocked during backup or review.
- The installer offers an editable destination and optional desktop shortcut. Uninstall can remove application settings and logs but never backup sources or destinations.
- The repository is canonical. OpenDesign is an existing frontend preview with sample data. Synchronization is explicit, allowlisted, baseline-checked, and stops on conflicts; it is not realtime.
- Verification uses isolated fixtures, source and packaged desktop smoke, updater policy, dependency audit, and build. External-drive stress, sudden disconnection, and real installed upgrades require separate acceptance checks; never claim them from local fixture tests.

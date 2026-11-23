# Zombie Cafe revival build

Builds an installable APK of Zombie Cafe (Capcom, 2011) for current Android
phones. It starts from [Airyz's zombie-cafe-revival](https://github.com/Airyzz/zombie-cafe-revival)
(crash fixes, toxin buy instead of real-money purchases, a reimplemented server)
and adds the fixes that the game needs to install and run on Android 14 to 17.

This folder holds only build scripts and patches. `build.sh` downloads the game
files from upstream at a pinned commit; nothing from the game is stored here.

## Installing

1. Copy `ZombieCafe-revival.apk` to the phone and open it. Allow "Install unknown apps"
   for the app you opened it from (Files, Chrome…) when Android asks.
2. If you already have Airyz's build installed, this installs over it as an update
   and keeps your cafe. It's signed with the same key (upstream's `debug.keystore`).
3. On first launch, Android may say the app was built for an older version. Tap OK.

**The phone must be able to run 32-bit apps.** The game's engine,
`libZombieCafeAndroid.so`, exists only as a 32-bit ARM binary and can't be
rebuilt. Pixel 7 and newer, and most flagships from 2024 on (Snapdragon 8 Gen 3
and 8 Elite, Exynos 2400, Dimensity 9300), have no 32-bit support. There the
install fails with "App not installed" (`INSTALL_FAILED_NO_MATCHING_ABIS`).
Most mid-range phones and older flagships still work. To check:
`adb shell getprop ro.product.cpu.abilist32` must print something.

## What this build changes

Upstream's build targets API 14 (Android 4.0). Android 14 refuses to install
anything below API 23, and Android 15 to 17 refuse anything below 24
([source](https://developer.android.com/about/versions/15/behavior-changes-all#minimum-target-api-level)).
So `patch.mjs` raises the target to 24 and fixes what that breaks:

| Problem at API 24 | Fix |
|---|---|
| The linker refuses libraries with text relocations, and `libZombieCafeAndroid.so` has one (the old NDK `__on_dlclose` stub loading `&__dso_handle` from an absolute literal) | Make that load PC-relative (three words), turn its relocation into `R_ARM_NONE`, drop `DT_TEXTREL` |
| `getDeviceId()` / `getSimSerialNumber()` need `READ_PHONE_STATE`, now a runtime permission the game never asks for, so they would throw | `ZcrCompat` wrappers return `null`, which is what Android 10+ already returns, so on those phones the game's device ID (and the server save keyed on it) doesn't change |
| Billing binds an implicit service intent, which throws `IllegalArgumentException` from API 21 on; only `SecurityException` was caught | Catch `RuntimeException`: the store's real-money buttons report billing unavailable instead of crashing |
| Apache HTTP client (the game's networking) | Declared with `uses-library org.apache.http.legacy` |
| Split-screen resizing is on by default | `resizeableActivity="false"`: the renderer expects one fixed landscape surface |

One fix isn't tied to the target. `Notification.setLatestEventInfo()` was
removed in Android 6.0, so every cafe reminder threw `NoSuchMethodError` from
the alarm receiver. `ZcrCompat.setLatestEventInfo` builds the same notification
with `Notification.Builder`.

`versionCode` goes from 19 to 20 so the APK installs as an update. The target
is the lowest one Android 15+ accepts, not higher. Apps targeting 25 or lower
run in the same SELinux domain as the original build (`untrusted_app_25`), so
the runtime memory patches in `libZombieCafeExtension` run under the same rules.

**Not yet run on a phone.** The APK was built and checked statically: the
signatures verify; neither library has text relocations; every patched call
site is in the dex. Nobody has launched it on a device yet. If it fails, the
log will show why: `adb logcat | grep -iE "zombie|linker|AndroidRuntime"`.

## Online play

The game talks to Airyz's revival server at `zc.airyz.xyz`, which
`libZombieCafeExtension` points it at. That server is Airyz's, not part of this
build. It was answering on 2026-11-23. Its code is in upstream's `tool/server`
(a Cloudflare Worker), so it can be redeployed if it ever goes away. The
replacement URLs must fit in the space of the original Capcom ones.

## Building

```bash
./build.sh        # -> dist/ZombieCafe-revival.apk, about 20 s after the first clone
```

Needs `git`, `go`, `node`, a JDK, `apktool`, `zipalign` and `apksigner`
(Ubuntu: `apt install apktool zipalign apksigner clang lld golang nodejs`).
With an Android NDK in `ANDROID_NDK_HOME` the native extension is built with
upstream's CMake recipe. Without one, it is built with stock clang + lld against
`ndk-shim/`, a few stand-in headers with bionic's values for 32-bit ARM.

`compat/ZcrCompat.smali` is generated from `compat/ZcrCompat.java`:

```bash
javac --release 8 -cp android-4.1.1.4.jar -d classes compat/ZcrCompat.java   # android.jar from Maven Central
dalvik-exchange --dex --min-sdk-version=8 --output=classes.dex classes
baksmali d classes.dex -o out    # -> out/com/capcom/zombiecafeandroid/ZcrCompat.smali
```

`patch.mjs` checks that each edit finds exactly the code it expects, and stops
the build if upstream changes underneath it.

Zombie Cafe and its assets belong to Capcom. The revival is Airyz's work.

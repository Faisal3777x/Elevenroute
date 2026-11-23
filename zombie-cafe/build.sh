#!/usr/bin/env bash
# Builds an installable Zombie Cafe APK for current Android phones from
# Airyz's zombie-cafe-revival, with the fixes in patch.mjs.
#
#   ./build.sh            -> dist/ZombieCafe-revival.apk
#
# Needs: git, go, node, java (keytool), apktool, zipalign, apksigner, and either
# an Android NDK (ANDROID_NDK_HOME or NDK_HOME) or clang + lld.
# Ubuntu: apt install apktool zipalign apksigner clang lld golang nodejs
set -euo pipefail

UPSTREAM=https://github.com/Airyzz/zombie-cafe-revival.git
COMMIT=712edb8fdcb5b92173978af63c8537c12d1abd3c

here="$(cd "$(dirname "$0")" && pwd)"
work="$here/.work"
src="$work/zombie-cafe-revival"
tree="$work/build"
out="$here/dist"
mkdir -p "$work" "$out"

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
for t in git go node apktool zipalign apksigner; do need "$t"; done

echo "== upstream @ ${COMMIT:0:7}"
if [ ! -d "$src/.git" ]; then
  git clone --quiet "$UPSTREAM" "$src"
fi
git -C "$src" fetch --quiet origin "$COMMIT" 2>/dev/null || true
git -C "$src" -c advice.detachedHead=false checkout --quiet "$COMMIT"

echo "== libZombieCafeExtension.so"
cpp="$src/src/lib/cpp"
ext="$work/native/libZombieCafeExtension.so"
rm -rf "$work/native" && mkdir -p "$work/native"
ndk="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
if [ -n "$ndk" ] && [ -f "$ndk/build/cmake/android.toolchain.cmake" ]; then
  # Upstream's own recipe.
  (cd "$work/native" && cmake "$cpp" -DCMAKE_TOOLCHAIN_FILE="$ndk/build/cmake/android.toolchain.cmake" \
     -DANDROID_ABI=armeabi-v7a -DANDROID_PLATFORM=android-21 >/dev/null && make --quiet)
else
  # No NDK: stock clang + lld against the small header shim in ndk-shim/.
  need clang; need ld.lld
  shim="$here/ndk-shim"
  target="--target=armv7a-linux-androideabi16 -march=armv7-a -mfloat-abi=softfp -mthumb -fPIC"
  for lib in libc libdl liblog; do
    clang $target -O2 -ffreestanding -nostdlib -shared -fuse-ld=lld -Wl,-soname,$lib.so \
      -Wno-incompatible-library-redeclaration -o "$work/native/$lib.so" "$shim/stubs/$lib.c"
  done
  cxxflags="$target -O2 -std=c++17 -ffreestanding -nostdinc -nostdinc++
    -isystem $shim/include -isystem $(clang -print-resource-dir)/include
    -fno-exceptions -fno-rtti -fno-unwind-tables -fno-asynchronous-unwind-tables -fno-stack-protector
    -Wno-pointer-to-int-cast -Wno-int-to-pointer-cast"
  clang++ $cxxflags -c "$cpp/ZombieCafeExtension.cpp" -o "$work/native/ext.o"
  clang++ $cxxflags -c "$cpp/Memory.cpp" -o "$work/native/mem.o"
  ld.lld -shared -soname libZombieCafeExtension.so --hash-style=both --no-rosegment \
    -z max-page-size=4096 -z noexecstack -z relro --build-id=sha1 --no-undefined \
    -o "$ext" "$work/native/ext.o" "$work/native/mem.o" -L"$work/native" -llog -ldl -lc
fi
[ -f "$ext" ] || { echo "extension build failed" >&2; exit 1; }

echo "== game data (upstream build_tool)"
(cd "$src" && go run ./tool/build_tool/ -i src/ -o "$tree" >"$work/build_tool.log" 2>&1) \
  || { tail -20 "$work/build_tool.log" >&2; exit 1; }
cp "$ext" "$tree/lib/armeabi/libZombieCafeExtension.so"

echo "== modern-Android fixes"
node "$here/patch.mjs" "$tree"

echo "== apk"
apktool b "$tree" -o "$work/unsigned.apk" >"$work/apktool.log" 2>&1 || { tail -20 "$work/apktool.log" >&2; exit 1; }
zipalign -f -p 4 "$work/unsigned.apk" "$work/aligned.apk"
# Upstream's debug key: same signature as Airyz's builds, so this installs as
# an update over them and Android keeps the same ANDROID_ID (and save) for the game.
apksigner sign --ks "$src/debug.keystore" --ks-pass pass:zombiecafe --ks-key-alias alias_name \
  --out "$out/ZombieCafe-revival.apk" "$work/aligned.apk"
apksigner verify "$out/ZombieCafe-revival.apk"
rm -f "$out/ZombieCafe-revival.apk.idsig"

echo
echo "built $out/ZombieCafe-revival.apk"
(command -v sha256sum >/dev/null && sha256sum "$out/ZombieCafe-revival.apk") || true

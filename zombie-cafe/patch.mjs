#!/usr/bin/env node
// Modern-Android fixes, applied to the apktool tree that upstream's build_tool
// writes (build/), before `apktool b`. Every edit checks that it found exactly
// what it expected, so a change upstream fails the build instead of shipping
// a half-patched APK.
//
//   node patch.mjs <build-dir>

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const build = process.argv[2]
if (!build || !fs.existsSync(path.join(build, 'apktool.yml'))) {
  console.error('usage: node patch.mjs <apktool build dir>')
  process.exit(1)
}

const TARGET_SDK = 24 // Android 15+ refuses to install anything lower.
const VERSION_CODE = 20 // Upstream's builds are 19; one higher installs as an update.

function fail(msg) {
  console.error(`patch.mjs: ${msg}`)
  process.exit(1)
}

function edit(rel, fn) {
  const file = path.join(build, rel)
  const before = fs.readFileSync(file, 'utf8')
  const after = fn(before)
  if (after === before) fail(`${rel}: nothing changed`)
  fs.writeFileSync(file, after)
}

function replaceOnce(text, from, to, where) {
  const n = text.split(from).length - 1
  if (n !== 1) fail(`${where}: expected 1 match for ${JSON.stringify(from)}, found ${n}`)
  return text.replace(from, () => to)
}

// 1. Target API 24 ----------------------------------------------------------
edit('apktool.yml', (t) => {
  t = replaceOnce(t, "targetSdkVersion: '14'", `targetSdkVersion: '${TARGET_SDK}'`, 'apktool.yml')
  return replaceOnce(t, "versionCode: '19'", `versionCode: '${VERSION_CODE}'`, 'apktool.yml')
})

// 2. Manifest ---------------------------------------------------------------
edit('AndroidManifest.xml', (t) => {
  // The game's HTTP code is the Apache client, which Android 9+ only hands to
  // apps that ask for it (it is added implicitly below API 28; this makes it explicit).
  t = replaceOnce(
    t,
    'android:name=".MyApplication">',
    'android:name=".MyApplication">\n        <uses-library android:name="org.apache.http.legacy" android:required="false"/>',
    'AndroidManifest.xml <application>',
  )
  // API 24+ lets activities be resized into split screen by default; the GL
  // renderer was written for one fixed landscape surface.
  return replaceOnce(
    t,
    'android:name=".ZombieCafeAndroid"',
    'android:name=".ZombieCafeAndroid" android:resizeableActivity="false"',
    'AndroidManifest.xml main activity',
  )
})

// 3. Smali ------------------------------------------------------------------
const COMPAT = 'Lcom/capcom/zombiecafeandroid/ZcrCompat;'
const smaliRoot = path.join(build, 'smali')
const counts = { getDeviceId: 0, getSimSerialNumber: 0, setLatestEventInfo: 0 }

function* smaliFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* smaliFiles(p)
    else if (e.name.endsWith('.smali')) yield p
  }
}

for (const file of smaliFiles(smaliRoot)) {
  const before = fs.readFileSync(file, 'utf8')
  let t = before
  // READ_PHONE_STATE is a runtime permission from API 23 on and the game never
  // requests it: route the calls through wrappers that return null instead of throwing.
  for (const m of ['getDeviceId', 'getSimSerialNumber']) {
    t = t.replace(
      new RegExp(`invoke-virtual(/range)? \\{([^}]*)\\}, Landroid/telephony/TelephonyManager;->${m}\\(\\)Ljava/lang/String;`, 'g'),
      (_, range, regs) => {
        counts[m]++
        return `invoke-static${range ?? ''} {${regs}}, ${COMPAT}->${m}(Landroid/telephony/TelephonyManager;)Ljava/lang/String;`
      },
    )
  }
  // Notification.setLatestEventInfo() no longer exists (removed in Android 6.0).
  // The wrapper returns a rebuilt notification, which replaces the original register.
  t = t.replace(
    /^(\s*)invoke-virtual \{([vp]\d+), ([^}]*)\}, Landroid\/app\/Notification;->setLatestEventInfo\(Landroid\/content\/Context;Ljava\/lang\/CharSequence;Ljava\/lang\/CharSequence;Landroid\/app\/PendingIntent;\)V$/gm,
    (_, indent, notif, rest) => {
      counts.setLatestEventInfo++
      return (
        `${indent}invoke-static {${notif}, ${rest}}, ${COMPAT}->setLatestEventInfo(Landroid/app/Notification;Landroid/content/Context;Ljava/lang/CharSequence;Ljava/lang/CharSequence;Landroid/app/PendingIntent;)Landroid/app/Notification;\n\n` +
        `${indent}move-result-object ${notif}`
      )
    },
  )
  if (t !== before) fs.writeFileSync(file, t)
}
// Expected counts for upstream commit 712edb8: the game and its bundled SDKs.
const expected = { getDeviceId: 9, getSimSerialNumber: 1, setLatestEventInfo: 2 }
for (const [k, v] of Object.entries(expected)) {
  if (counts[k] !== v) fail(`smali: expected ${v} ${k} call(s), patched ${counts[k]}`)
}

// Billing binds an implicit service intent, which throws IllegalArgumentException
// from API 21 on. Only SecurityException was caught, so the store's real-money
// buttons would crash the game; catch both and report "billing unavailable".
edit('smali/com/capcom/billing/BillingService.smali', (t) =>
  replaceOnce(
    t,
    '.catch Ljava/lang/SecurityException; {:try_start_0 .. :try_end_0} :catch_0',
    '.catch Ljava/lang/RuntimeException; {:try_start_0 .. :try_end_0} :catch_0',
    'BillingService.smali',
  ),
)

fs.copyFileSync(
  path.join(here, 'compat', 'ZcrCompat.smali'),
  path.join(smaliRoot, 'com', 'capcom', 'zombiecafeandroid', 'ZcrCompat.smali'),
)

// 4. libZombieCafeAndroid.so: remove its one text relocation -----------------
// Android refuses to load libraries with text relocations into apps that target
// API 23+. The only one is the old NDK crtbegin_so `__on_dlclose` stub, which
// loads &__dso_handle from an absolute literal. Make that load PC-relative,
// drop its relocation and the DT_TEXTREL flag.
patchTextRelocation(path.join(build, 'lib', 'armeabi', 'libZombieCafeAndroid.so'))

function patchTextRelocation(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt32BE(0) !== 0x7f454c46 || b[4] !== 1 || b[5] !== 1) fail('lib: not a 32-bit little-endian ELF')
  const u32 = (o) => b.readUInt32LE(o)
  const u16 = (o) => b.readUInt16LE(o)

  const phoff = u32(0x1c), phentsize = u16(0x2a), phnum = u16(0x2c)
  const loads = []
  let dyn = null
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize
    const p = { type: u32(o), offset: u32(o + 4), vaddr: u32(o + 8), filesz: u32(o + 16), memsz: u32(o + 20), flags: u32(o + 24) }
    if (p.type === 1) loads.push(p)
    if (p.type === 2) dyn = p
  }
  const toFile = (va) => {
    const p = loads.find((l) => va >= l.vaddr && va < l.vaddr + l.filesz)
    if (!p) fail(`lib: address 0x${va.toString(16)} is outside the file`)
    return va - p.vaddr + p.offset
  }
  const writable = (va) => loads.some((l) => (l.flags & 2) && va >= l.vaddr && va < l.vaddr + l.memsz)

  // Dynamic section: REL table, TEXTREL, FLAGS.
  const DT_NULL = 0, DT_REL = 17, DT_RELSZ = 18, DT_TEXTREL = 22, DT_FLAGS = 30, DF_TEXTREL = 4
  const entries = []
  for (let o = dyn.offset; o < dyn.offset + dyn.filesz; o += 8) {
    entries.push({ o, tag: u32(o), val: u32(o + 4) })
    if (u32(o) === DT_NULL) break
  }
  const tag = (t) => entries.find((e) => e.tag === t)
  const rel = tag(DT_REL), relsz = tag(DT_RELSZ)
  if (!rel || !relsz) fail('lib: no DT_REL table')

  // Every relocation that lands in a read-only segment is a text relocation.
  const textRels = []
  const tables = [[rel, relsz], [tag(23 /* DT_JMPREL */), tag(2 /* DT_PLTRELSZ */)]]
  for (const [start, size] of tables) {
    if (!start || !size) continue
    for (let o = toFile(start.val); o < toFile(start.val) + size.val; o += 8) {
      const off = u32(o), info = u32(o + 4)
      if ((info & 0xff) !== 0 && !writable(off)) textRels.push({ o, off, info })
    }
  }
  if (textRels.length === 0 && !tag(DT_TEXTREL)) {
    console.log('lib: no text relocations (already patched)')
    return
  }
  const LIT = 0x5ddcc
  if (textRels.length !== 1 || textRels[0].off !== LIT || textRels[0].info !== 0x17 /* R_ARM_RELATIVE */) {
    fail(`lib: unexpected text relocations: ${JSON.stringify(textRels.map((r) => [r.off.toString(16), r.info.toString(16)]))}`)
  }

  // 0x5ddc0  add r0, pc, #4   ->  ldr r0, [pc, #4]     r0 = literal (an offset now)
  // 0x5ddc4  ldr r0, [r0]     ->  add r0, pc, r0       r0 = 0x5ddcc + offset = &__dso_handle
  // 0x5ddc8  b   __cxa_finalize@plt (unchanged)
  // 0x5ddcc  .word __dso_handle  ->  .word __dso_handle - 0x5ddcc
  const code = toFile(0x5ddc0)
  const want = [0xe28f0004, 0xe5900000, 0xeafffe8e]
  want.forEach((w, i) => {
    if (u32(code + 4 * i) !== w) fail(`lib: unexpected instruction at 0x${(0x5ddc0 + 4 * i).toString(16)}`)
  })
  const dsoHandle = u32(code + 12) // the REL addend: link-time address of __dso_handle
  if (!writable(dsoHandle)) fail('lib: literal does not point at writable data')
  b.writeUInt32LE(0xe59f0004, code)
  b.writeUInt32LE(0xe08f0000, code + 4)
  b.writeUInt32LE((dsoHandle - LIT) >>> 0, code + 12)
  b.writeUInt32LE(0, textRels[0].o + 4) // R_ARM_NONE: the linker skips it

  // DT_RELCOUNT says the first N entries are all R_ARM_RELATIVE. Bionic ignores
  // it, but keep it true: swap the now-empty entry to slot N-1 and count one fewer.
  const relcount = tag(0x6ffffffa /* DT_RELCOUNT */)
  const relStart = toFile(rel.val)
  if (relcount && textRels[0].o < relStart + relcount.val * 8) {
    const last = relStart + (relcount.val - 1) * 8
    if (textRels[0].o !== last) {
      b.copy(b, textRels[0].o, last, last + 8) // last counted RELATIVE entry -> the freed slot
      b.writeUInt32LE(LIT, last) // the emptied entry -> end of the counted run
      b.writeUInt32LE(0, last + 4)
    }
    b.writeUInt32LE(relcount.val - 1, relcount.o + 4)
  }
  const flags = tag(DT_FLAGS)
  if (flags && flags.val & DF_TEXTREL) b.writeUInt32LE(flags.val & ~DF_TEXTREL, flags.o + 4)

  // Remove DT_TEXTREL by shifting the rest of the table (read live, after the
  // edits above) up one slot; the freed last slot becomes another DT_NULL.
  const tr = entries.findIndex((e) => e.tag === DT_TEXTREL)
  if (tr >= 0) {
    const end = entries[entries.length - 1].o + 8
    b.copy(b, entries[tr].o, entries[tr].o + 8, end)
    b.writeUInt32LE(DT_NULL, end - 8)
    b.writeUInt32LE(0, end - 4)
  }
  fs.writeFileSync(file, b)
  console.log(`lib: removed the text relocation (__dso_handle at 0x${dsoHandle.toString(16)})`)
}

console.log(`patched: target API ${TARGET_SDK}, versionCode ${VERSION_CODE}, ` +
  `${counts.getDeviceId + counts.getSimSerialNumber} phone-ID calls, ` +
  `${counts.setLatestEventInfo} notification calls, billing bind, manifest`)

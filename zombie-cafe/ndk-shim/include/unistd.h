#pragma once
#include <stddef.h>
/* The extension only asks sysconf() for the page size. 32-bit ARM Android
   always uses 4 KiB pages, so answer that directly instead of depending on
   bionic's _SC_* numbering. */
#define _SC_PAGE_SIZE 0x0028
static inline long zc_sysconf(int name) { (void)name; return 4096; }
#define sysconf(name) zc_sysconf(name)

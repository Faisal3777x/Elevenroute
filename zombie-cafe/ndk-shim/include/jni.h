#pragma once
#include <stdint.h>
typedef int32_t jint;
struct _JavaVM;
typedef struct _JavaVM JavaVM;
#define JNIEXPORT __attribute__((visibility("default")))
#define JNICALL
#define JNI_VERSION_1_4 0x00010004
/* As in the NDK's jni.h: the VM looks these up by their C names. */
#ifdef __cplusplus
extern "C" {
#endif
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* reserved);
#ifdef __cplusplus
}
#endif

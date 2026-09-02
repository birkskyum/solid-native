cmake_minimum_required(VERSION 3.13)
project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# React Native enables any host ccache binary it finds. Ignore a stale optional
# installation without disabling a healthy cache.
if(CCACHE_FOUND)
    execute_process(
        COMMAND "${CCACHE_FOUND}" --version
        RESULT_VARIABLE SOLID_NATIVE_CCACHE_STATUS
        OUTPUT_QUIET
        ERROR_QUIET
    )
    if(NOT SOLID_NATIVE_CCACHE_STATUS EQUAL 0)
        set_property(GLOBAL PROPERTY RULE_LAUNCH_COMPILE "")
        set_property(GLOBAL PROPERTY RULE_LAUNCH_LINK "")
    endif()
endif()

if(NOT DEFINED SOLID_NATIVE_FABRIC_HOST_DIR OR SOLID_NATIVE_FABRIC_HOST_DIR STREQUAL "")
    message(FATAL_ERROR "SOLID_NATIVE_FABRIC_HOST_DIR must point to the installed @solid-native/fabric-host package")
endif()
get_filename_component(SOLID_NATIVE_FABRIC_HOST_DIR "${SOLID_NATIVE_FABRIC_HOST_DIR}" ABSOLUTE)
set(SOLID_NATIVE_ANDROID_DIR "${SOLID_NATIVE_FABRIC_HOST_DIR}/native/android")
include("${SOLID_NATIVE_ANDROID_DIR}/SolidNativeRuntime.cmake")
solid_native_configure_android_target(${CMAKE_PROJECT_NAME})

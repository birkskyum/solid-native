include_guard(GLOBAL)

if(NOT DEFINED REACT_ANDROID_DIR)
    message(FATAL_ERROR "Solid Native requires REACT_ANDROID_DIR from React Native's application CMake integration.")
endif()

foreach(_SOLID_NATIVE_VERSION_PART MAJOR MINOR PATCH)
    if(NOT DEFINED SOLID_NATIVE_REACT_NATIVE_VERSION_${_SOLID_NATIVE_VERSION_PART})
        message(FATAL_ERROR "Solid Native requires SOLID_NATIVE_REACT_NATIVE_VERSION_${_SOLID_NATIVE_VERSION_PART} from its reviewed boundary manifest.")
    endif()
endforeach()

set(_SOLID_NATIVE_ANDROID_DIR "${CMAKE_CURRENT_LIST_DIR}")
get_filename_component(
    _SOLID_NATIVE_NATIVE_DIR
    "${_SOLID_NATIVE_ANDROID_DIR}/.."
    ABSOLUTE
)
set(_SOLID_NATIVE_FABRIC_DIR "${_SOLID_NATIVE_NATIVE_DIR}/fabric")
set(_SOLID_NATIVE_WORKLETS_DIR "${_SOLID_NATIVE_NATIVE_DIR}/worklets")

function(solid_native_configure_android_target target)
    if(NOT TARGET "${target}")
        message(FATAL_ERROR "Solid Native cannot configure missing CMake target '${target}'.")
    endif()
    get_target_property(_solid_native_configured "${target}" SOLID_NATIVE_RUNTIME_CONFIGURED)
    if(_solid_native_configured)
        return()
    endif()

    target_sources(
        "${target}"
        PRIVATE
        "${_SOLID_NATIVE_ANDROID_DIR}/SolidNativeBindingsInstaller.cpp"
        "${_SOLID_NATIVE_FABRIC_DIR}/SolidNativeFabricApi.cpp"
        "${_SOLID_NATIVE_FABRIC_DIR}/SolidNativeFabricTransactionCoordinator.cpp"
        "${_SOLID_NATIVE_WORKLETS_DIR}/SolidNativeUIWorklet.cpp"
    )

    # React Native's Android Folly binary encodes its feature mode in an ABI
    # link check. Compile the shared coordinator with that exact mode.
    target_compile_options("${target}" PRIVATE ${folly_FLAGS})
    target_compile_definitions(
        "${target}"
        PRIVATE
        "SOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR=${SOLID_NATIVE_REACT_NATIVE_VERSION_MAJOR}"
        "SOLID_NATIVE_REACT_NATIVE_VERSION_MINOR=${SOLID_NATIVE_REACT_NATIVE_VERSION_MINOR}"
        "SOLID_NATIVE_REACT_NATIVE_VERSION_PATCH=${SOLID_NATIVE_REACT_NATIVE_VERSION_PATCH}"
    )

    target_include_directories(
        "${target}"
        PRIVATE
        "${REACT_ANDROID_DIR}/src/main/jni"
        "${REACT_ANDROID_DIR}/../ReactCommon"
        "${_SOLID_NATIVE_ANDROID_DIR}"
        "${_SOLID_NATIVE_FABRIC_DIR}"
        "${_SOLID_NATIVE_WORKLETS_DIR}"
    )
    set_property(TARGET "${target}" PROPERTY SOLID_NATIVE_RUNTIME_CONFIGURED TRUE)
endfunction()

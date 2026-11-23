plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.overshift.proto"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.overshift.proto"
        // The Thor ships Android 13 (API 33). 29 (Android 10) keeps the Retroid and AYANEO
        // dual-screen devices in reach; multi-resume across displays arrived in Android 10.
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1-prototype"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Sideload builds only for now: sign release with the debug key so `assembleRelease` installs.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// No library dependencies: the shell uses only the Android framework.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version from the release tag: CI sets OVERSHIFT_VERSION to vX.Y.Z when it publishes a release.
// versionCode = X*10000 + Y*100 + Z, so every release installs over the one before it.
// Any other build is "dev-<commit>" with versionCode 1; the in-app update check skips dev builds.
val releaseVersion: String? = System.getenv("OVERSHIFT_VERSION")
    ?.takeIf { it.isNotBlank() }
    ?.removePrefix("v")
    ?.also { require(Regex("""\d{1,2}\.\d{1,2}\.\d{1,2}""").matches(it)) { "OVERSHIFT_VERSION must look like v1.2.3, got $it" } }
val appVersionName = releaseVersion ?: "dev-" + (System.getenv("GITHUB_SHA")?.take(7) ?: "local")
val appVersionCode = releaseVersion?.split(".")?.map { it.toInt() }?.let { (a, b, c) -> a * 10000 + b * 100 + c } ?: 1

// One fixed signing key, so updates install over the installed app. CI rebuilds it from the
// OVERSHIFT_SIGNING_PASSWORD secret (tools/signing-key.py) and points OVERSHIFT_KEYSTORE at it.
// Without it (local builds, pull requests from forks) Gradle's own debug key is used.
val keystorePath: String? = System.getenv("OVERSHIFT_KEYSTORE")?.takeIf { it.isNotBlank() }

android {
    namespace = "app.overshift.proto"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.overshift.proto"
        // The Thor ships Android 13 (API 33). 29 (Android 10) keeps the Retroid and AYANEO
        // dual-screen devices in reach; multi-resume across displays arrived in Android 10.
        minSdk = 29
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        if (keystorePath != null) {
            create("overshift") {
                storeFile = file(keystorePath)
                storeType = "pkcs12"
                storePassword = System.getenv("OVERSHIFT_KEYSTORE_PASSWORD")
                keyAlias = "overshift"
                keyPassword = System.getenv("OVERSHIFT_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            signingConfigs.findByName("overshift")?.let { signingConfig = it }
        }
        release {
            isMinifyEnabled = false
            // Sideload builds only for now: sign release with the same key as debug so `assembleRelease` installs.
            signingConfig = signingConfigs.findByName("overshift") ?: signingConfigs.getByName("debug")
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

dependencies {
    // The app itself uses only the Android framework; JUnit runs the plain-JVM update tests.
    testImplementation("junit:junit:4.13.2")
}

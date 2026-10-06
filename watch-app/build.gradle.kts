plugins {
    id("com.android.application") version "9.4.1" apply false
    // O AGP 9 já traz Kotlin embutido; declarar aqui só fixa a versão usada
    id("org.jetbrains.kotlin.android") version "2.4.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
}

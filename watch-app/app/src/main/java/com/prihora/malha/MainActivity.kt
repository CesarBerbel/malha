package com.prihora.malha

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent

class MainActivity : ComponentActivity() {
    private lateinit var state: AppState

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        state = AppState(applicationContext)
        setContent {
            MalhaApp(state) { on ->
                // Tela ligada só durante o treino
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Ao voltar ao app, busca o plano mais recente e envia treinos pendentes
        if (state.session == null) state.refresh(quiet = true)
    }
}

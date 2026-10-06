package com.prihora.malha

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : ComponentActivity() {
    private lateinit var state: AppState
    private var onPermissionDone: (() -> Unit)? = null

    // Pedido de permissão de batimentos (e atividade, para calorias); o treino começa com ou sem ela
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        onPermissionDone?.invoke()
        onPermissionDone = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        state = AppState(applicationContext)
        state.requestHeartPermission = { done ->
            onPermissionDone = done
            val heartPerm = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
            permissionLauncher.launch(arrayOf(heartPerm, Manifest.permission.ACTIVITY_RECOGNITION))
        }
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

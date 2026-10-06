package com.prihora.malha

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.concurrent.futures.await
import androidx.core.content.ContextCompat
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DataTypeAvailability
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseTrackedStatus
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import kotlin.math.roundToInt

/**
 * Batimentos durante o treino via Health Services (sessão de exercício de musculação).
 * A sessão continua medindo com a tela apagada; o próprio Health Services calcula média,
 * máxima e calorias do treino inteiro.
 */
class HeartMonitor(private val context: Context) {
    private val client = HealthServices.getClient(context).exerciseClient

    var bpm by mutableIntStateOf(0)          // 0 = sem leitura no momento
        private set
    var avg by mutableIntStateOf(0)
        private set
    var max by mutableIntStateOf(0)
        private set
    var calories by mutableDoubleStateOf(0.0)
        private set
    var status by mutableStateOf("")         // motivo quando não há batimentos
        private set

    /** Cada leitura nova; o AppState usa para a média de cada exercício. */
    var onSample: ((Int) -> Unit)? = null

    private val callback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            val metrics = update.latestMetrics
            metrics.getData(DataType.HEART_RATE_BPM).lastOrNull()?.let {
                val v = it.value.roundToInt()
                if (v > 0) {
                    bpm = v
                    onSample?.invoke(v)
                }
            }
            metrics.getData(DataType.HEART_RATE_BPM_STATS)?.let {
                avg = it.average.roundToInt()
                max = it.max.roundToInt()
            }
            metrics.getData(DataType.CALORIES_TOTAL)?.let { calories = it.total }
            if (update.exerciseStateInfo.state.isEnded) bpm = 0
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) = Unit
        override fun onRegistered() = Unit
        override fun onRegistrationFailed(throwable: Throwable) {
            status = "Batimentos indisponíveis"
        }

        override fun onAvailabilityChanged(dataType: androidx.health.services.client.data.DataType<*, *>, availability: Availability) {
            // Ex.: relógio frouxo no pulso → sensor perde contato
            if (dataType == DataType.HEART_RATE_BPM && availability is DataTypeAvailability) {
                if (availability != DataTypeAvailability.AVAILABLE) bpm = 0
            }
        }
    }

    fun hasPermission(): Boolean {
        val perm = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
        return ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
    }

    /** Começa (ou retoma, se já é nossa) a sessão de exercício. */
    suspend fun start() {
        reset()
        if (!hasPermission()) { status = "Sem permissão de batimentos"; return }
        try {
            val info = client.getCurrentExerciseInfoAsync().await()
            when (info.exerciseTrackedStatus) {
                ExerciseTrackedStatus.OTHER_APP_IN_PROGRESS -> { status = "Outro app de treino está ativo"; return }
                ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS -> { client.setUpdateCallback(callback); return }
            }
            val caps = client.getCapabilitiesAsync().await()
            val type = listOf(ExerciseType.WEIGHTLIFTING, ExerciseType.STRENGTH_TRAINING)
                .firstOrNull { it in caps.supportedExerciseTypes }
                ?: run { status = "Relógio sem modo musculação"; return }
            val supported = caps.getExerciseTypeCapabilities(type).supportedDataTypes
            val wanted = setOf(DataType.HEART_RATE_BPM, DataType.HEART_RATE_BPM_STATS, DataType.CALORIES_TOTAL)
                .filter { it in supported }.toSet()
            if (DataType.HEART_RATE_BPM !in wanted) { status = "Sem sensor de batimentos"; return }
            client.setUpdateCallback(callback)
            client.startExerciseAsync(
                ExerciseConfig.builder(type)
                    .setDataTypes(wanted)
                    .setIsAutoPauseAndResumeEnabled(false)
                    .setIsGpsEnabled(false)
                    .build()
            ).await()
        } catch (e: Exception) {
            status = "Batimentos indisponíveis"
        }
    }

    /** Ao reabrir o app com um treino em andamento: volta a ouvir a sessão que já é nossa. */
    suspend fun reattach() {
        if (!hasPermission()) return
        runCatching {
            val info = client.getCurrentExerciseInfoAsync().await()
            if (info.exerciseTrackedStatus == ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS) client.setUpdateCallback(callback)
        }
    }

    suspend fun stop() {
        runCatching {
            val info = client.getCurrentExerciseInfoAsync().await()
            if (info.exerciseTrackedStatus == ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS) client.endExerciseAsync().await()
        }
        runCatching { client.clearUpdateCallbackAsync(callback).await() }
        bpm = 0
    }

    private fun reset() {
        bpm = 0; avg = 0; max = 0; calories = 0.0; status = ""
    }
}

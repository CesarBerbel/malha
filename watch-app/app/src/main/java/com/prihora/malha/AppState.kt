package com.prihora.malha

import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import java.util.Calendar

enum class Overlay { NONE, CONNECT, WEIGHT, STOP }

class AppState(context: Context) {
    private val repo = Repo(context)
    private val scope: CoroutineScope = MainScope()
    private val vibrator: Vibrator = (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator

    var plan by mutableStateOf(repo.planJson?.let { runCatching { parsePlanData(it) }.getOrNull() })
        private set
    var code by mutableStateOf(repo.code)
        private set
    var session by mutableStateOf(repo.sessionJson?.let { sessionFromJson(it) })
        private set
    var viewDay by mutableIntStateOf(today())
    var overlay by mutableStateOf(Overlay.NONE)
    var status by mutableStateOf("")          // mensagem curta de sincronização
    var busy by mutableStateOf(false)
    var pendingCount by mutableIntStateOf(repo.pending.length())
        private set
    var lastDone by mutableStateOf<Summary?>(null)
    var lastDoneSent by mutableStateOf(false)

    val settings: Settings get() = plan?.settings ?: Settings()
    private var lastAlertAt = 0L

    // ---------- batimentos ----------

    val heart = HeartMonitor(context)

    /** A Activity pede as permissões de batimentos e depois chama o callback. */
    var requestHeartPermission: ((onDone: () -> Unit) -> Unit)? = null
    private var unsavedSamples = 0

    init {
        heart.onSample = { bpm -> addHeartSample(bpm) }
        if (session != null) scope.launch { heart.reattach() } // app reaberto no meio do treino
    }

    private fun addHeartSample(bpm: Int) {
        val s = session ?: return
        // Conta para o exercício a execução e o descanso dele; hidratação e "pronto" ficam de fora
        if (s.phase != Phase.WORK && s.phase != Phase.REST) return
        session = s.copy(hr = s.hr + (s.ex to (s.hr[s.ex] ?: HrAgg()).add(bpm)))
        if (++unsavedSamples >= 15) { unsavedSamples = 0; saveSession() }
    }

    private fun heartTotals(s: Session): HrTotals? {
        var avg = heart.avg
        var max = heart.max
        if (avg == 0) { // sem estatística do Health Services: usa as leituras recebidas
            val count = s.hr.values.sumOf { it.count }
            if (count > 0) {
                avg = (s.hr.values.sumOf { it.sum } / count).toInt()
                max = s.hr.values.maxOf { it.max }
            }
        }
        return if (avg > 0 || heart.calories > 0) HrTotals(avg, max, heart.calories) else null
    }

    fun today(): Int = Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - 1 // 0 = domingo, como no app web
    fun dayPlan(day: Int): DayPlan = plan?.plans?.get(day) ?: DayPlan("", emptyList())

    // ---------- sincronização ----------

    fun connect(newCode: String) {
        val c = newCode.filter { it.isDigit() }
        if (c.length != CODE_DIGITS) { status = "O código tem 6 números"; return }
        if (busy) return
        scope.launch {
            busy = true
            status = "Conectando…"
            try {
                val json = repo.fetchPlan(c)
                plan = parsePlanData(json)
                repo.planJson = json
                repo.code = c
                repo.lastSync = System.currentTimeMillis()
                code = c
                overlay = Overlay.NONE
                status = "Conectado!"
                buzz(longArrayOf(0, 60, 80, 60))
                uploadPending()
            } catch (e: HttpError) {
                status = when (e.status) {
                    404 -> "Código não encontrado"
                    429 -> "Muitas tentativas. Aguarde."
                    else -> "Erro do servidor (${e.status})"
                }
            } catch (e: Exception) {
                status = "Sem internet"
            } finally {
                busy = false
            }
        }
    }

    fun refresh(quiet: Boolean = false) {
        val c = code ?: return
        scope.launch {
            busy = true
            if (!quiet) status = "Atualizando…"
            try {
                val json = repo.fetchPlan(c)
                plan = parsePlanData(json)
                repo.planJson = json
                repo.lastSync = System.currentTimeMillis()
                status = if (quiet) "" else "Plano atualizado"
            } catch (e: HttpError) {
                status = if (e.status == 404) "Código não existe mais. Conecte de novo." else "Erro do servidor (${e.status})"
            } catch (e: Exception) {
                status = if (quiet) "Sem internet: usando plano salvo" else "Sem internet"
            } finally {
                busy = false
            }
            uploadPending()
        }
    }

    private suspend fun uploadPending() {
        pendingCount = repo.uploadPending()
        if (pendingCount == 0 && lastDone != null) lastDoneSent = true
    }

    fun disconnect() {
        repo.code = null
        code = null
        overlay = Overlay.CONNECT
    }

    val lastSyncText: String
        get() {
            val t = repo.lastSync
            if (t == 0L) return ""
            val cal = Calendar.getInstance().apply { timeInMillis = t }
            return String.format("Atualizado %02d:%02d", cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE))
        }

    // ---------- treino ----------

    private fun saveSession() {
        repo.sessionJson = session?.toJson()
    }

    fun start(day: Int) {
        val ask = requestHeartPermission
        if (!heart.hasPermission() && ask != null) { ask { startSession(day) }; return }
        startSession(day)
    }

    private fun startSession(day: Int) {
        val p = dayPlan(day)
        if (p.items.isEmpty()) return
        val now = System.currentTimeMillis()
        session = Session(day = day, name = p.name, items = p.items, t0 = now, start = now)
        lastDone = null
        lastAlertAt = 0
        saveSession()
        scope.launch { heart.start() }
    }

    /** Play (inicia/retoma a série) ou Pausa (fecha a série e começa o descanso do zero). */
    fun primary() {
        val s = session ?: return
        val now = System.currentTimeMillis()
        if (s.phase == Phase.WORK) {
            val log = s.log + SetLog(s.ex, s.set, now - s.t0, 0, s.item.weight)
            val next = s.set + 1
            session = when {
                next < s.item.sets -> s.copy(set = next, phase = Phase.REST, t0 = now, log = log)
                s.ex < s.items.lastIndex -> s.copy(ex = s.ex + 1, set = 0, phase = Phase.HYDRATE, t0 = now, log = log)
                else -> { finish(s.copy(log = log, phase = Phase.READY)); return }
            }
            buzz(longArrayOf(0, 80))
        } else {
            val log = if (s.phase != Phase.READY && s.log.isNotEmpty())
                s.log.dropLast(1) + s.log.last().copy(restMs = now - s.t0) else s.log
            session = s.copy(phase = Phase.WORK, t0 = now, log = log)
            buzz(longArrayOf(0, 40, 60, 40))
        }
        lastAlertAt = 0
        saveSession()
    }

    fun skip() {
        val s = session ?: return
        if (s.ex >= s.items.lastIndex) { finish(s); return }
        session = if (s.phase == Phase.WORK || s.phase == Phase.READY)
            s.copy(ex = s.ex + 1, set = 0, phase = Phase.READY, t0 = System.currentTimeMillis())
        else s.copy(ex = s.ex + 1, set = 0, phase = Phase.HYDRATE)
        saveSession()
    }

    fun stepWeight(dir: Int) {
        val s = session ?: return
        val cur = parseKg(s.item.weight) ?: 0.0
        val value = fmtKg((cur + dir * settings.weightStep).coerceAtLeast(0.0))
        session = s.copy(items = s.items.mapIndexed { i, it -> if (i == s.ex) it.copy(weight = value) else it })
        saveSession()
    }

    fun adjustSets(delta: Int) {
        val s = session ?: return
        val sets = maxOf(s.set + 1, s.item.sets + delta)
        session = s.copy(items = s.items.mapIndexed { i, it -> if (i == s.ex) it.copy(sets = sets) else it })
        saveSession()
    }

    fun finish(base: Session? = session) {
        val s0 = base ?: return
        val now = System.currentTimeMillis()
        val s = if (s0.phase == Phase.WORK) s0.copy(log = s0.log + SetLog(s0.ex, s0.set, now - s0.t0, 0, s0.item.weight)) else s0
        if (s.log.isEmpty()) { discard(); return }
        val totals = heartTotals(s)
        repo.addPending(s.historyEntry(now, totals))
        pendingCount = repo.pending.length()
        lastDone = s.summary(now, totals)
        lastDoneSent = false
        session = null
        overlay = Overlay.NONE
        saveSession()
        buzz(longArrayOf(0, 200, 100, 200))
        scope.launch { heart.stop(); uploadPending() }
    }

    fun discard() {
        session = null
        overlay = Overlay.NONE
        saveSession()
        scope.launch { heart.stop() }
    }

    /** Chamado a cada ~200 ms durante o treino: vibra quando o descanso passa do limite. */
    fun checkAlert(now: Long) {
        val s = session ?: return
        if (s.phase != Phase.REST && s.phase != Phase.HYDRATE) return
        if (now - s.t0 < s.limitMs(settings)) return
        if (lastAlertAt == 0L || now - lastAlertAt >= settings.alertRepeat * 1000L) {
            lastAlertAt = now
            buzz(longArrayOf(0, 400, 150, 400, 150, 400))
        }
    }

    private fun buzz(pattern: LongArray) {
        if (!settings.vibrate || !vibrator.hasVibrator()) return
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }
}

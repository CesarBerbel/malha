package com.prihora.malha

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.Locale
import kotlin.math.roundToLong

// ---------- plano (vem do celular pelo servidor) ----------

data class Item(
    val exId: String,
    val name: String,
    val group: String,
    val sets: Int,
    val reps: String,
    val weight: String,
    val rest: Int, // segundos; 0 = usar o padrão dos ajustes
)

data class DayPlan(val name: String, val items: List<Item>)

data class Settings(
    val restAlert: Int = 60,
    val hydrateAlert: Int = 180,
    val alertRepeat: Int = 15,
    val weightStep: Double = 2.5,
    val vibrate: Boolean = true,
)

data class PlanData(val plans: Map<Int, DayPlan>, val settings: Settings, val updatedAt: String)

fun parsePlanData(json: String): PlanData {
    val root = JSONObject(json)
    val exercises = root.optJSONObject("exercises") ?: JSONObject()
    val plansObj = root.optJSONObject("plans") ?: JSONObject()
    val plans = mutableMapOf<Int, DayPlan>()
    for (key in plansObj.keys()) {
        val day = key.toIntOrNull() ?: continue
        val p = plansObj.optJSONObject(key) ?: continue
        val arr = p.optJSONArray("items") ?: JSONArray()
        val items = (0 until arr.length()).mapNotNull { i ->
            val obj = arr.optJSONObject(i) ?: return@mapNotNull null
            val exId = obj.optString("exId")
            val meta = exercises.optJSONObject(exId)
            Item(
                exId = exId,
                name = meta?.optString("name")?.takeIf { it.isNotBlank() } ?: exId,
                group = meta?.optString("group") ?: "",
                sets = obj.optInt("sets", 3).coerceIn(1, 20),
                reps = obj.optString("reps", "8"),
                weight = if (obj.isNull("weight")) "" else obj.optString("weight", ""),
                rest = if (obj.isNull("rest")) 0 else obj.optInt("rest", 0),
            )
        }
        plans[day] = DayPlan(p.optString("name", ""), items)
    }
    val s = root.optJSONObject("settings") ?: JSONObject()
    val settings = Settings(
        restAlert = s.optInt("restAlert", 60),
        hydrateAlert = s.optInt("hydrateAlert", 180),
        alertRepeat = s.optInt("alertRepeat", 15).coerceAtLeast(5),
        weightStep = s.optDouble("weightStep", 2.5),
        vibrate = s.optBoolean("vibrate", true),
    )
    return PlanData(plans, settings, root.optString("updatedAt", ""))
}

// ---------- sessão de treino ----------
// Fases: READY (aguardando play) → WORK (série) → REST (descanso) → ... → HYDRATE (troca de exercício)

enum class Phase { READY, WORK, REST, HYDRATE }

data class SetLog(val ex: Int, val set: Int, val workMs: Long, val restMs: Long, val weight: String)

data class Session(
    val day: Int,
    val name: String,
    val items: List<Item>,
    val ex: Int = 0,
    val set: Int = 0,
    val phase: Phase = Phase.READY,
    val t0: Long,
    val start: Long,
    val log: List<SetLog> = emptyList(),
) {
    val item: Item get() = items[ex]
    /** Nenhuma série feita nem em andamento: pode ser cancelado sem salvar. */
    val isEmpty: Boolean get() = log.isEmpty() && phase != Phase.WORK

    fun limitMs(settings: Settings): Long = when (phase) {
        Phase.REST -> (if (item.rest > 0) item.rest else settings.restAlert) * 1000L
        Phase.HYDRATE -> settings.hydrateAlert * 1000L
        else -> Long.MAX_VALUE
    }
}

data class Summary(val name: String, val durationMs: Long, val exercises: Int, val sets: Int, val volumeKg: Long)

private fun Item.toJson() = JSONObject()
    .put("exId", exId).put("name", name).put("group", group)
    .put("sets", sets).put("reps", reps).put("weight", weight).put("rest", rest)

private fun itemFromJson(o: JSONObject) = Item(
    o.getString("exId"), o.optString("name"), o.optString("group"),
    o.optInt("sets", 3), o.optString("reps", "8"), o.optString("weight", ""), o.optInt("rest", 0),
)

fun Session.toJson(): String = JSONObject()
    .put("day", day).put("name", name)
    .put("items", JSONArray(items.map { it.toJson() }))
    .put("ex", ex).put("set", set).put("phase", phase.name)
    .put("t0", t0).put("start", start)
    .put("log", JSONArray(log.map {
        JSONObject().put("ex", it.ex).put("set", it.set).put("workMs", it.workMs).put("restMs", it.restMs).put("weight", it.weight)
    }))
    .toString()

fun sessionFromJson(json: String): Session? = runCatching {
    val o = JSONObject(json)
    val items = o.getJSONArray("items").let { a -> (0 until a.length()).map { itemFromJson(a.getJSONObject(it)) } }
    val log = o.getJSONArray("log").let { a ->
        (0 until a.length()).map {
            val l = a.getJSONObject(it)
            SetLog(l.getInt("ex"), l.getInt("set"), l.getLong("workMs"), l.getLong("restMs"), l.optString("weight"))
        }
    }
    Session(
        day = o.getInt("day"), name = o.optString("name"), items = items,
        ex = o.getInt("ex"), set = o.getInt("set"), phase = Phase.valueOf(o.getString("phase")),
        t0 = o.getLong("t0"), start = o.getLong("start"), log = log,
    )
}.getOrNull()

/** Treino concluído no mesmo formato do histórico do app web. */
fun Session.historyEntry(now: Long): JSONObject {
    val exercises = JSONArray()
    items.forEachIndexed { i, it ->
        val sets = log.filter { l -> l.ex == i }
        if (sets.isEmpty()) return@forEachIndexed
        exercises.put(
            JSONObject()
                .put("exId", it.exId).put("name", it.name).put("reps", it.reps).put("weight", it.weight)
                .put("weights", JSONArray(sets.map { l -> l.weight }))
                .put("setsDone", sets.size).put("setsPlanned", it.sets)
                .put("workMs", sets.sumOf { l -> l.workMs })
        )
    }
    return JSONObject()
        .put("id", "w" + start.toString(36) + (100000..999999).random().toString(36))
        .put("source", "watch")
        .put("date", Instant.ofEpochMilli(start).toString())
        .put("day", day)
        .put("name", name)
        .put("durationMs", now - start)
        .put("exercises", exercises)
}

fun Session.summary(now: Long): Summary {
    val done = log.groupBy { it.ex }
    val volume = log.sumOf { l -> (parseKg(l.weight) ?: 0.0) * (items[l.ex].reps.trim().toIntOrNull() ?: 0) }
    return Summary(name, now - start, done.size, log.size, volume.roundToLong())
}

// ---------- formatação ----------

val DAYS = listOf("Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado")

fun fmtTime(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%02d:%02d", m, s)
}

fun fmtDuration(ms: Long): String {
    val min = (ms / 60000.0).roundToLong()
    return if (min < 60) "$min min" else "${min / 60}h${String.format(Locale.ROOT, "%02d", min % 60)}"
}

fun parseKg(v: String): Double? = v.replace(',', '.').trim().toDoubleOrNull()

fun fmtKg(n: Double): String {
    val r = Math.round(n * 100) / 100.0
    val s = if (r == Math.floor(r)) r.toLong().toString() else r.toString()
    return s.replace('.', ',')
}

fun estimateMin(items: List<Item>, s: Settings): Int {
    var sec = 0
    items.forEachIndexed { i, it ->
        sec += it.sets * 40 + (it.sets - 1) * (if (it.rest > 0) it.rest else s.restAlert)
        if (i < items.lastIndex) sec += s.hydrateAlert
    }
    return maxOf(1, Math.round(sec / 60.0).toInt())
}

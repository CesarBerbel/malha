package com.prihora.malha

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

const val BASE_URL = "https://prihora.com"
const val CODE_DIGITS = 6 // o código do celular tem 6 números

class HttpError(val status: Int, message: String) : Exception(message)

/** Dados guardados no relógio (SharedPreferences) e chamadas à API de sincronização. */
class Repo(context: Context) {
    private val prefs = context.getSharedPreferences("malha", Context.MODE_PRIVATE)

    var code: String?
        get() = prefs.getString("code", null)
        set(v) = prefs.edit().putString("code", v).apply()

    var planJson: String?
        get() = prefs.getString("plan", null)
        set(v) = prefs.edit().putString("plan", v).apply()

    var sessionJson: String?
        get() = prefs.getString("session", null)
        set(v) = prefs.edit().putString("session", v).apply()

    var lastSync: Long
        get() = prefs.getLong("lastSync", 0)
        set(v) = prefs.edit().putLong("lastSync", v).apply()

    /** Treinos concluídos que ainda não chegaram ao servidor. */
    var pending: JSONArray
        get() = runCatching { JSONArray(prefs.getString("pending", "[]")) }.getOrDefault(JSONArray())
        set(v) = prefs.edit().putString("pending", v.toString()).apply()

    fun addPending(entry: JSONObject) {
        pending = pending.put(entry)
    }

    suspend fun fetchPlan(code: String): String = withContext(Dispatchers.IO) {
        http("GET", "$BASE_URL/api/sync/$code", null)
    }

    /** Envia os treinos pendentes. Retorna quantos ficaram pendentes. */
    suspend fun uploadPending(): Int = withContext(Dispatchers.IO) {
        val c = code ?: return@withContext pending.length()
        val list = pending
        if (list.length() == 0) return@withContext 0
        runCatching {
            http("POST", "$BASE_URL/api/sync/$c/history", JSONObject().put("entries", list).toString())
            pending = JSONArray()
        }
        pending.length()
    }

    private fun http(method: String, url: String, body: String?): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray()) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (status !in 200..299) throw HttpError(status, text)
            return text
        } finally {
            conn.disconnect()
        }
    }
}

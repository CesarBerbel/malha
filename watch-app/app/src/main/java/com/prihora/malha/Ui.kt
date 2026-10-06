package com.prihora.malha

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import kotlinx.coroutines.delay

// ---------- cores (as mesmas do app web) ----------
private val Bg = Color(0xFF000000)
private val Surface = Color(0xFF1C1F27)
private val Surface2 = Color(0xFF262A34)
private val TextC = Color(0xFFF3F4F6)
private val Muted = Color(0xFF9AA1B0)
private val Lime = Color(0xFFC8F542)
private val Ink = Color(0xFF0A0B0F)
private val RestC = Color(0xFF5AA9FF)
private val HydrateC = Color(0xFF2DD4E6)
private val AlertC = Color(0xFFFF5A5F)

private val GROUP_COLORS = mapOf(
    "Peito" to 0xFFFF6B57, "Costas" to 0xFF4D9DFF, "Ombros" to 0xFFA78BFA, "Bíceps" to 0xFFFBBF24,
    "Tríceps" to 0xFFF472B6, "Pernas" to 0xFF34D399, "Glúteos" to 0xFFFB923C, "Panturrilha" to 0xFF22D3EE,
    "Abdômen" to 0xFF94A3B8,
)

private fun groupColor(g: String) = Color(GROUP_COLORS[g] ?: 0xFF94A3B8)

@Composable
fun MalhaApp(state: AppState, keepScreenOn: (Boolean) -> Unit) {
    val inSession = state.session != null
    LaunchedEffect(inSession) { keepScreenOn(inSession) }

    MaterialTheme {
        Box(Modifier.fillMaxSize().background(Bg)) {
            when {
                state.overlay == Overlay.CONNECT || (state.code == null && state.plan == null) -> ConnectScreen(state)
                state.session != null -> when (state.overlay) {
                    Overlay.WEIGHT -> WeightScreen(state)
                    Overlay.STOP -> StopScreen(state)
                    else -> SessionScreen(state)
                }
                state.lastDone != null -> DoneScreen(state)
                else -> HomeScreen(state)
            }
        }
    }
}

// ---------- início: treino do dia ----------

@Composable
private fun HomeScreen(state: AppState) {
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val day = state.viewDay
    val p = state.dayPlan(day)
    Box(Modifier.fillMaxSize()) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            autoCentering = null, // lista começa no topo, não no meio da tela
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item { Spacer(Modifier.height(18.dp)) }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RoundButton(30.dp, Surface2, { state.viewDay = (day + 6) % 7 }) { Glyph(G.LEFT, TextC, 14.dp) }
                    Text(
                        if (day == state.today()) "HOJE" else DAYS[day].uppercase(),
                        color = Lime, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
                    )
                    RoundButton(30.dp, Surface2, { state.viewDay = (day + 1) % 7 }) { Glyph(G.RIGHT, TextC, 14.dp) }
                }
            }
            if (p.items.isEmpty()) {
                item { Title("Descanso") }
                item { Sub("Sem treino neste dia") }
            } else {
                item { Title(p.name.ifBlank { "Treino de ${DAYS[day]}" }) }
                item { Sub("${p.items.size} exercícios · ~${estimateMin(p.items, state.settings)} min") }
                item {
                    RoundButton(58.dp, Lime, { state.start(day) }, Modifier.padding(top = 4.dp)) { Glyph(G.PLAY, Ink, 24.dp) }
                }
                p.items.forEachIndexed { i, it ->
                    item { ExerciseRow(i + 1, it) }
                }
            }
            item { Spacer(Modifier.height(6.dp)) }
            item {
                Pill(if (state.busy) "Atualizando…" else "Atualizar plano", Surface2, TextC) { state.refresh() }
            }
            item {
                val info = listOf(state.status.ifBlank { state.lastSyncText }, if (state.pendingCount > 0) "${state.pendingCount} treino(s) a enviar" else "")
                    .filter { it.isNotBlank() }.joinToString("\n")
                if (info.isNotBlank()) Text(info, color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center)
            }
            item {
                Text(
                    "Código ${state.code ?: "—"} · trocar",
                    color = Muted, fontSize = 11.sp,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { state.overlay = Overlay.CONNECT }.padding(6.dp),
                )
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
        TimeText()
    }
}

@Composable
private fun ExerciseRow(n: Int, it: Item) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(start = 0.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(46.dp).background(groupColor(it.group)))
        Text("$n", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(26.dp), textAlign = TextAlign.Center)
        Column(Modifier.padding(vertical = 7.dp)) {
            Text(it.name, color = TextC, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("${it.sets}×${it.reps}" + (if (it.weight.isNotBlank()) " · ${it.weight} kg" else ""), color = Muted, fontSize = 12.sp)
        }
    }
}

// ---------- conectar com o código do celular ----------
// Teclado numérico próprio: o teclado do sistema no relógio se perde com campos que filtram o texto.

@Composable
private fun ConnectScreen(state: AppState) {
    var digits by remember { mutableStateOf("") }
    val canGoBack = state.code != null || state.plan != null

    fun press(key: String) {
        when (key) {
            "DEL" -> { digits = digits.dropLast(1); state.status = "" }
            "OK" -> state.connect(digits)
            else -> if (digits.length < CODE_DIGITS) {
                digits += key
                if (digits.length == CODE_DIGITS) state.connect(digits) // conecta sozinho no 6º número
            }
        }
    }

    Column(
        Modifier.fillMaxSize().padding(top = 16.dp, bottom = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            when {
                state.busy -> "Conectando…"
                state.status.isNotBlank() -> state.status
                else -> "Código do celular"
            },
            color = if (state.status.isNotBlank() && !state.busy) AlertC.copy(alpha = 0.9f) else Muted,
            fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.padding(top = 4.dp, bottom = 6.dp)) {
            repeat(CODE_DIGITS) { i ->
                Box(
                    Modifier
                        .size(width = 19.dp, height = 25.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Surface)
                        .border(1.dp, if (i == digits.length) Lime.copy(alpha = 0.6f) else Surface2, RoundedCornerShape(6.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(digits.getOrNull(i)?.toString() ?: "", color = Lime, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                }
                if (i == 2) Spacer(Modifier.width(4.dp))
            }
        }
        listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("DEL", "0", "OK")).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), modifier = Modifier.padding(vertical = 2.dp)) {
                row.forEach { key ->
                    val ready = key == "OK" && digits.length == CODE_DIGITS
                    Box(
                        Modifier
                            .size(width = 48.dp, height = 30.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (ready) Lime else if (key.length > 1) Surface2 else Surface)
                            .clickable { press(key) },
                        contentAlignment = Alignment.Center,
                    ) {
                        when (key) {
                            "DEL" -> Glyph(G.BACKSPACE, TextC, 18.dp)
                            "OK" -> Glyph(G.CHECK, if (ready) Ink else Muted, 15.dp)
                            else -> Text(key, color = TextC, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
        if (canGoBack) {
            Text(
                "Voltar", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 2.dp).clip(RoundedCornerShape(8.dp))
                    .clickable { state.overlay = Overlay.NONE; state.status = "" }.padding(horizontal = 10.dp, vertical = 3.dp),
            )
        }
    }
}

// ---------- treino em andamento ----------

@Composable
private fun SessionScreen(state: AppState) {
    val s = state.session ?: return
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            state.checkAlert(now)
            delay(200)
        }
    }
    val elapsed = if (s.phase == Phase.READY) 0L else now - s.t0
    val limit = s.limitMs(state.settings)
    val over = elapsed >= limit
    val blinkOn = (now / 500) % 2 == 0L
    val color = when {
        over -> AlertC
        s.phase == Phase.WORK -> Lime
        s.phase == Phase.REST -> RestC
        s.phase == Phase.HYDRATE -> HydrateC
        else -> Muted
    }
    val progress = when (s.phase) {
        Phase.WORK -> (elapsed % 60_000) / 60_000f
        Phase.REST, Phase.HYDRATE -> (elapsed.toFloat() / limit).coerceIn(0f, 1f)
        else -> 0f
    }
    val label = when (s.phase) {
        Phase.READY -> "PRONTO"
        Phase.WORK -> "EXECUTANDO"
        Phase.REST -> if (over) "VOLTE AO TREINO" else "DESCANSO"
        Phase.HYDRATE -> if (over) "VOLTE AO TREINO" else "HIDRATAÇÃO · A SEGUIR"
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (over && blinkOn) Box(Modifier.fillMaxSize().clip(CircleShape).background(AlertC.copy(alpha = 0.18f)))
        Canvas(Modifier.fillMaxSize().padding(3.dp)) {
            val stroke = 7.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawArc(Surface2, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
            if (progress > 0f) drawArc(color, -90f, 360f * progress, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Column(
            Modifier.fillMaxSize().padding(horizontal = 26.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(label, color = color, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
            Text(
                s.item.name, color = TextC, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, lineHeight = 16.sp,
            )
            // Toque na linha de série/carga para ajustar a carga
            Text(
                "${minOf(s.set + 1, s.item.sets)}/${s.item.sets} · ${s.item.reps}×" + (if (s.item.weight.isNotBlank()) " · ${s.item.weight} kg" else " · carga"),
                color = Muted, fontSize = 12.sp,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { state.overlay = Overlay.WEIGHT }.padding(horizontal = 6.dp, vertical = 2.dp),
            )
            Text(
                fmtTime(elapsed),
                color = if (over) (if (blinkOn) AlertC else AlertC.copy(alpha = 0.35f)) else if (s.phase == Phase.READY) Muted else TextC,
                fontSize = 40.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-1).sp,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RoundButton(34.dp, Surface2, { state.skip() }) { Glyph(G.SKIP, TextC, 14.dp) }
                RoundButton(56.dp, if (s.phase == Phase.WORK) Color.White else Lime, { state.primary() }) {
                    Glyph(if (s.phase == Phase.WORK) G.PAUSE else G.PLAY, Ink, 22.dp)
                }
                RoundButton(34.dp, Surface2, { state.overlay = Overlay.STOP }) {
                    Glyph(if (s.isEmpty) G.X else G.STOP, AlertC, 13.dp)
                }
            }
        }
    }
}

@Composable
private fun WeightScreen(state: AppState) {
    val s = state.session ?: return
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("CARGA", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
        Text(s.item.name, color = TextC, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 8.dp)) {
            RoundButton(44.dp, Surface2, { state.stepWeight(-1) }) { Glyph(G.MINUS, TextC, 16.dp) }
            Text(s.item.weight.ifBlank { "0" }, color = TextC, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold)
            RoundButton(44.dp, Surface2, { state.stepWeight(1) }) { Glyph(G.PLUS, TextC, 16.dp) }
        }
        Text("kg · passo de ${fmtKg(state.settings.weightStep)}", color = Muted, fontSize = 11.sp)
        Spacer(Modifier.height(10.dp))
        Pill("OK", Lime, Ink) { state.overlay = Overlay.NONE }
    }
}

@Composable
private fun StopScreen(state: AppState) {
    val s = state.session ?: return
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    ScalingLazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        autoCentering = null,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item { Spacer(Modifier.height(20.dp)) }
        if (s.isEmpty) {
            item { Title("Cancelar treino?") }
            item { Sub("Nenhuma série feita. Nada será salvo.") }
            item { Pill("Cancelar treino", AlertC, Color.White) { state.discard() } }
            item { Pill("Voltar", Surface2, TextC) { state.overlay = Overlay.NONE } }
        } else {
            item { Title("Encerrar treino?") }
            item { Sub("${s.log.size + (if (s.phase == Phase.WORK) 1 else 0)} série(s) feitas") }
            item { Pill("Salvar e encerrar", Lime, Ink) { state.finish() } }
            item { Pill("Descartar", AlertC.copy(alpha = 0.2f), AlertC) { state.discard() } }
            item { Pill("Continuar", Surface2, TextC) { state.overlay = Overlay.NONE } }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun DoneScreen(state: AppState) {
    val d = state.lastDone ?: return
    val listState = rememberScalingLazyListState(initialCenterItemIndex = 0)
    ScalingLazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        autoCentering = null,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        item { Spacer(Modifier.height(14.dp)) }
        item { RoundButton(44.dp, Lime, {}) { Glyph(G.CHECK, Ink, 20.dp) } }
        item { Title("Treino concluído!") }
        item { Sub("${fmtDuration(d.durationMs)} · ${d.sets} séries" + (if (d.volumeKg > 0) " · ${d.volumeKg} kg" else "")) }
        item {
            Text(
                if (state.lastDoneSent) "Enviado ao celular ✓" else "Será enviado quando houver internet",
                color = if (state.lastDoneSent) Lime else Muted, fontSize = 11.sp, textAlign = TextAlign.Center,
            )
        }
        item { Pill("OK", Lime, Ink) { state.lastDone = null } }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

// ---------- componentes ----------

@Composable
private fun Title(text: String) = Text(
    text, color = TextC, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold,
    textAlign = TextAlign.Center, lineHeight = 21.sp, modifier = Modifier.padding(horizontal = 14.dp),
)

@Composable
private fun Sub(text: String, size: TextUnit = 12.sp) = Text(
    text, color = Muted, fontSize = size, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 16.dp),
)

@Composable
private fun RoundButton(size: Dp, bg: Color, onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier.size(size).clip(CircleShape).background(bg).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
        content = content,
    )
}

@Composable
private fun Pill(text: String, bg: Color, fg: Color, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth(0.82f)
            .clip(RoundedCornerShape(50))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = fg, fontSize = 14.sp, fontWeight = FontWeight.Bold)
    }
}

enum class G { PLAY, PAUSE, SKIP, STOP, X, PLUS, MINUS, CHECK, LEFT, RIGHT, BACKSPACE }

/** Ícones desenhados à mão (sem depender de biblioteca de ícones). */
@Composable
private fun Glyph(kind: G, color: Color, size: Dp) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val line = w * 0.16f
        fun stroke(a: Offset, b: Offset, c: Offset? = null) = drawPath(
            Path().apply { moveTo(a.x, a.y); lineTo(b.x, b.y); if (c != null) lineTo(c.x, c.y) },
            color, style = Stroke(line, cap = StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round),
        )
        when (kind) {
            G.PLAY -> drawPath(Path().apply { moveTo(w * 0.22f, h * 0.1f); lineTo(w * 0.92f, h * 0.5f); lineTo(w * 0.22f, h * 0.9f); close() }, color)
            G.PAUSE -> {
                drawRoundRect(color, Offset(w * 0.18f, h * 0.1f), Size(w * 0.22f, h * 0.8f), CornerRadius(w * 0.06f))
                drawRoundRect(color, Offset(w * 0.6f, h * 0.1f), Size(w * 0.22f, h * 0.8f), CornerRadius(w * 0.06f))
            }
            G.SKIP -> {
                drawPath(Path().apply { moveTo(w * 0.12f, h * 0.12f); lineTo(w * 0.7f, h * 0.5f); lineTo(w * 0.12f, h * 0.88f); close() }, color)
                drawRoundRect(color, Offset(w * 0.76f, h * 0.12f), Size(w * 0.14f, h * 0.76f), CornerRadius(w * 0.05f))
            }
            G.STOP -> drawRoundRect(color, Offset(w * 0.1f, h * 0.1f), Size(w * 0.8f, h * 0.8f), CornerRadius(w * 0.18f))
            G.X -> { stroke(Offset(w * 0.15f, h * 0.15f), Offset(w * 0.85f, h * 0.85f)); stroke(Offset(w * 0.85f, h * 0.15f), Offset(w * 0.15f, h * 0.85f)) }
            G.PLUS -> { stroke(Offset(w * 0.5f, h * 0.1f), Offset(w * 0.5f, h * 0.9f)); stroke(Offset(w * 0.1f, h * 0.5f), Offset(w * 0.9f, h * 0.5f)) }
            G.MINUS -> stroke(Offset(w * 0.1f, h * 0.5f), Offset(w * 0.9f, h * 0.5f))
            G.CHECK -> stroke(Offset(w * 0.12f, h * 0.52f), Offset(w * 0.4f, h * 0.8f), Offset(w * 0.9f, h * 0.22f))
            G.LEFT -> stroke(Offset(w * 0.65f, h * 0.12f), Offset(w * 0.3f, h * 0.5f), Offset(w * 0.65f, h * 0.88f))
            G.RIGHT -> stroke(Offset(w * 0.35f, h * 0.12f), Offset(w * 0.7f, h * 0.5f), Offset(w * 0.35f, h * 0.88f))
            G.BACKSPACE -> {
                drawPath(
                    Path().apply { moveTo(w * 0.3f, h * 0.2f); lineTo(w * 0.95f, h * 0.2f); lineTo(w * 0.95f, h * 0.8f); lineTo(w * 0.3f, h * 0.8f); lineTo(w * 0.04f, h * 0.5f); close() },
                    color, style = Stroke(w * 0.09f, join = androidx.compose.ui.graphics.StrokeJoin.Round),
                )
                drawLine(color, Offset(w * 0.5f, h * 0.36f), Offset(w * 0.76f, h * 0.64f), w * 0.09f, StrokeCap.Round)
                drawLine(color, Offset(w * 0.76f, h * 0.36f), Offset(w * 0.5f, h * 0.64f), w * 0.09f, StrokeCap.Round)
            }
        }
    }
}


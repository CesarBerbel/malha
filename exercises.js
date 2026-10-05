// Biblioteca com os exercícios de musculação mais executados.
const GROUPS = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Pernas', 'Glúteos', 'Panturrilha', 'Abdômen'];

const EXERCISES = [
  ['Peito', 'Supino reto com barra'],
  ['Peito', 'Supino reto com halteres'],
  ['Peito', 'Supino inclinado com barra'],
  ['Peito', 'Supino inclinado com halteres'],
  ['Peito', 'Supino declinado'],
  ['Peito', 'Crucifixo com halteres'],
  ['Peito', 'Voador (peck deck)'],
  ['Peito', 'Crossover no cabo'],
  ['Peito', 'Flexão de braço'],
  ['Peito', 'Paralelas (mergulho)'],

  ['Costas', 'Puxada frontal (pulldown)'],
  ['Costas', 'Barra fixa'],
  ['Costas', 'Remada curvada com barra'],
  ['Costas', 'Remada unilateral com halter'],
  ['Costas', 'Remada baixa no cabo'],
  ['Costas', 'Remada cavalinho'],
  ['Costas', 'Pulldown com braços estendidos'],
  ['Costas', 'Levantamento terra'],

  ['Ombros', 'Desenvolvimento com halteres'],
  ['Ombros', 'Desenvolvimento militar com barra'],
  ['Ombros', 'Elevação lateral'],
  ['Ombros', 'Elevação frontal'],
  ['Ombros', 'Crucifixo invertido'],
  ['Ombros', 'Remada alta'],
  ['Ombros', 'Encolhimento (trapézio)'],

  ['Bíceps', 'Rosca direta com barra'],
  ['Bíceps', 'Rosca alternada com halteres'],
  ['Bíceps', 'Rosca martelo'],
  ['Bíceps', 'Rosca Scott'],
  ['Bíceps', 'Rosca concentrada'],
  ['Bíceps', 'Rosca no cabo'],

  ['Tríceps', 'Tríceps pulley (corda)'],
  ['Tríceps', 'Tríceps pulley (barra)'],
  ['Tríceps', 'Tríceps testa'],
  ['Tríceps', 'Tríceps francês'],
  ['Tríceps', 'Tríceps coice'],
  ['Tríceps', 'Mergulho no banco'],
  ['Tríceps', 'Supino fechado'],

  ['Pernas', 'Agachamento livre'],
  ['Pernas', 'Agachamento no Smith'],
  ['Pernas', 'Leg press 45°'],
  ['Pernas', 'Hack machine'],
  ['Pernas', 'Cadeira extensora'],
  ['Pernas', 'Mesa flexora'],
  ['Pernas', 'Cadeira flexora'],
  ['Pernas', 'Afundo / passada'],
  ['Pernas', 'Agachamento búlgaro'],
  ['Pernas', 'Stiff'],

  ['Glúteos', 'Elevação pélvica (hip thrust)'],
  ['Glúteos', 'Cadeira abdutora'],
  ['Glúteos', 'Cadeira adutora'],
  ['Glúteos', 'Glúteo no cabo (coice)'],

  ['Panturrilha', 'Panturrilha em pé'],
  ['Panturrilha', 'Panturrilha sentado'],
  ['Panturrilha', 'Panturrilha no leg press'],

  ['Abdômen', 'Abdominal supra (crunch)'],
  ['Abdômen', 'Abdominal infra'],
  ['Abdômen', 'Abdominal oblíquo'],
  ['Abdômen', 'Abdominal na polia'],
  ['Abdômen', 'Elevação de pernas'],
  ['Abdômen', 'Prancha'],
].map(([group, name]) => ({ id: slug(name), name, group }));

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

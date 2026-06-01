import alphonsoMascot from '../assets/alphonso-mascot.webp';
import joseMascot from '../assets/jose-mascot.webp';
import miyaMascot from '../assets/miya-mascot-main.webp';
import hectorMascot from '../assets/hector-mascot.webp';
import mariaMascot from '../assets/agents/maria/maria-mascot-main.webp';
import marcusMascot from '../assets/agents/marcus/marcus-mascot-main.webp';
import { getCustomAvatarDataUrl } from './agentAvatarService';

const AGENT_MASCOT_MAP = {
  jose: joseMascot,
  alphonso: alphonsoMascot,
  miya: miyaMascot,
  hector: hectorMascot,
  maria: mariaMascot,
  marcus: marcusMascot
};

export function getAgentMascotPath(agentId) {
  const id = String(agentId || '').toLowerCase();
  const custom = getCustomAvatarDataUrl(id);
  if (custom) return custom;
  return AGENT_MASCOT_MAP[id] || null;
}

export function getAgentInitials(nameOrId) {
  const safe = String(nameOrId || '').trim();
  if (!safe) return '?';
  const words = safe.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return safe.slice(0, 2).toUpperCase();
}

"use strict";
// Deterministic typed replies shared by the advisor's transport fixtures.
module.exports = function skillReply(packet, { target = "s0", gate = [0.9, 0.9, 0.1], fits = 0.8 } = {}) {
  return Object.fromEntries(Object.entries(packet.questions).map(([id, q]) => {
    if (q.type === "noul") return [id, { type: "noul", noul: id.startsWith("fits::") ? fits :
      gate[["gate::acts_on_user_system", "gate::would_follow_documented_procedure", "gate::prose_suffices"].indexOf(id)] }];
    const ids = Object.keys(q.criteria), choice = ids.includes(target) ? target : ids[0];
    return [id, { type: "choice", choice, confidence: 1,
      probabilities: Object.fromEntries(ids.map((key) => [key, Number(key === choice)])) }];
  }));
};

// src/hooks/useRefreshBusEffect.js
import { useEffect } from "react";
import { onRefresh } from "../refreshBus";

/**
 * Kör callbacken varje gång refresh-bussen triggas (wall_state/midnatt).
 */
function useRefreshBusEffect(cb) {
  useEffect(() => onRefresh(cb), [cb]);
}

// Exportera både default och named för maximal kompatibilitet
export default useRefreshBusEffect;
export { useRefreshBusEffect };
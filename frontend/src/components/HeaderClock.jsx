import React, { useEffect, useState } from "react";

export default function HeaderClock({ className }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Svensk tid, HH:mm
  const time = now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });

  return (
    <span
      className={className}
      aria-label={`Klockan är ${time}`}
      style={{ whiteSpace: "nowrap" }} // håll den kompakt i headern
    >
      {time}
    </span>
  );
}
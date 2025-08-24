import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import "./ShoppingList.css";
import { playSound } from "../utils/playSound";
import useDragScroll from "../hooks/useDragScroll";
import useRefreshBusEffect from "../hooks/useRefreshBusEffect"; // ✅ default-import

function getCurrentWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

function ShoppingList() {
  const [currentWeek, setCurrentWeek] = useState(getCurrentWeekNumber(new Date()));
  const { ref } = useDragScroll({ axis: "y", momentum: true });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ category: "", item: "", amount: "" });

  // ✅ Gör fetch till en memoiserad funktion så vi kan anropa den från flera effekter
  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shoppinglist")
      .select("*")
      .eq("week", currentWeek)
      .order("sortorder", { ascending: true })
      .order("category", { ascending: true })
      .order("item", { ascending: true });

    if (error) {
      console.error("Fel vid hämtning:", error.message);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }, [currentWeek]);

  // Ladda vid veckobyte/initialt
  useEffect(() => { fetchItems(); }, [fetchItems]);
  // ✅ Lyssna på global refresh-buss (wall_state/midnatt → ev. vecka skift + refetch)
  useRefreshBusEffect(() => {
    const todayWeek = getCurrentWeekNumber(new Date());
    if (todayWeek !== currentWeek) setCurrentWeek(todayWeek);
    console.log("🔁 Refresh-buss → refetchar shoppinglist (v.", currentWeek, ")");
    fetchItems();
  });
  // ✅ Direkt Realtime på tabellen (insert/update/delete → refetch)
  useEffect(() => {
    const ch = supabase
      .channel("shoppinglist-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shoppinglist" },
        () => fetchItems()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchItems]);

  async function toggleItem(item) {
    const updatedChecked = !item.checked;
    const { error } = await supabase
      .from("shoppinglist")
      .update({ checked: updatedChecked })
      .eq("id", item.id);

    if (error) {
      console.error("Kunde inte uppdatera vara:", error.message);
      playSound("error.mp3");
    } else {
      playSound(updatedChecked ? "check-on.mp3" : "check-off.mp3");
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, checked: updatedChecked } : i))
      );
    }
  }

  async function handleAddItem() {
    const { category, item, amount } = formData;
    if (!item.trim()) return;

    const { error, data } = await supabase
      .from("shoppinglist")
      .insert([{
        item: item.trim(),
        amount: amount.trim(),
        category: category.trim() || null,
        week: currentWeek,
        checked: false,
      }])
      .select();

    if (error) {
      console.error("Fel vid tillägg:", error.message);
    } else {
      setItems((prev) => [...prev, data[0]]);
      setFormData({ category: "", item: "", amount: "" });
      setShowForm(false);
      // (Realtime‑lyssnaren ovan refetchar ändå, men vi uppdaterar lokalt också för snappy UI)
    }
  }

  function handlePreviousWeek() { setCurrentWeek((prev) => Math.max(prev - 1, 1)); }
  function handleNextWeek() { setCurrentWeek((prev) => prev + 1); }

  const grouped = items.reduce((acc, item) => {
    const category = item.category?.trim() || "Utan kategori";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  return (
    <div ref={ref} className="shopping-list-container">
      <div className="week-selector">
        <button onClick={handlePreviousWeek}>{"<"}</button>
        <h2>Handlalappen (v. {currentWeek})</h2>
        <button onClick={handleNextWeek}>{">"}</button>
      </div>

      {loading && <p>Laddar...</p>}
      {!loading && items.length === 0 && <p>Ingen lista för denna vecka.</p>}
      {!loading &&
        Object.entries(grouped).map(([category, catItems]) => (
          <div key={category} className="shopping-category">
            <h3>{category}</h3>
            {catItems.map((item) => (
              <div key={item.id} className="shopping-item">
                <label>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleItem(item)}
                  />
                  <span className={item.checked ? "checked" : ""}>
                    {item.item}
                    {item.amount && ` – ${item.amount}`}
                  </span>
                </label>
              </div>
            ))}
          </div>
        ))}

      <button className="add-button" onClick={() => setShowForm(true)}>＋</button>

      {showForm && (
        <div className="popup-overlay" onClick={() => setShowForm(false)}>
          <div className="popup-form" onClick={(e) => e.stopPropagation()}>
            <h3>Lägg till vara</h3>
            <input
              placeholder="Vara"
              value={formData.item}
              onChange={(e) => setFormData({ ...formData, item: e.target.value })}
            />
            <input
              placeholder="Mängd (valfritt)"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            />
            <input
              placeholder="Kategori"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            />
            <div className="form-buttons">
              <button onClick={handleAddItem}>Spara</button>
              <button onClick={() => setShowForm(false)}>Avbryt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ShoppingList;

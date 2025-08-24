import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import "./ShoppingList.css";
import { createClient } from '@supabase/supabase-js';

const cfg = window.FW_CONFIG || {};
const url = cfg.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const key = cfg.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);
const { FW_CONFIG = {} } = window;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

const STORE_ISLE_ORDER = [
  "Bröd", "Frukt & Grönt", "Mejeri", "Kött", "Kyckling", "Korv",
  "Fisk", "Frys", "Torrvaror", "Såser", "Konserver", "Övrigt"
];

function getSortOrder(category) {
  const index = STORE_ISLE_ORDER.indexOf(category);
  return index !== -1 ? index : 999;
}

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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    category: "",
    item: "",
    amount: ""
  });

  useEffect(() => {
    // Registrera push
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('service-worker.js').then(swReg => {
        Notification.requestPermission().then(async (permission) => {
          if (permission === 'granted') {
            const sub = await swReg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapid),
            });

            const { error } = await supabase
              .from('push_subscriptions')
              .insert([
                {
                  endpoint: sub.endpoint,
                  keys: {
                    auth: sub.keys.auth,
                    p256dh: sub.keys.p256dh,
                  },
                }
              ]);

            if (error) {
              console.error("Kunde inte spara prenumeration:", error);
            } else {
              console.log("Pushprenumeration sparad i Supabase.");
            }
          }
        });
      });
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [currentWeek]);

  async function fetchItems() {
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
      setItems(data);
    }

    setLoading(false);
  }

  async function toggleItem(item) {
    const updatedChecked = !item.checked;

    const { error } = await supabase
      .from("shoppinglist")
      .update({ checked: updatedChecked })
      .eq("id", item.id);

    if (error) {
      console.error("Kunde inte uppdatera vara:", error.message);
      //playSound('error.mp3');
    } else {
      //playSound('check-off.mp3');
      setItems((prevItems) =>
        prevItems.map((i) =>
          i.id === item.id ? { ...i, checked: updatedChecked } : i
        )
      );
    }
  }

  async function handleAddItem() {
    const { category, item, amount } = formData;
    if (!item.trim()) return;

    const itemName = item.trim();
    const itemCategory = category.trim() || "Övrigt";
    const sortorder = getSortOrder(itemCategory);

    const { error, data } = await supabase
      .from("shoppinglist")
      .insert([{
        item: itemName,
        amount: amount.trim(),
        category: itemCategory,
        week: currentWeek,
        checked: false,
        source: "user",
        created_at: new Date().toISOString(),
        sortorder: sortorder
      }])
      .select();

    if (error) {
      console.error("Fel vid tillägg:", error.message);
    } else {
      setItems((prev) => [...prev, data[0]]);
      setFormData({ category: "", item: "", amount: "" });
      setShowForm(false);

      // 🔔 Skicka pushnotis till serverfunktion
      +fetch(`${FW_CONFIG.FUNCTIONS_BASE}/send-push-on-new-item`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ record: data[0] })
});
    }
  }

  function handlePreviousWeek() {
    setCurrentWeek((prev) => Math.max(prev - 1, 1));
  }

  function handleNextWeek() {
    setCurrentWeek((prev) => prev + 1);
  }

  const grouped = items.reduce((acc, item) => {
    const category = item.category?.trim() || "Utan kategori";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  return (
    <div className="shopping-list-container">
      <div className="week-selector">
        <button onClick={handlePreviousWeek}>{"<"}</button>
        <h2>Inköpslista (v. {currentWeek})</h2>
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

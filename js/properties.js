function $(id) {
  return document.getElementById(id);
}

document.addEventListener("DOMContentLoaded", async function () {
  var propForm = $("propertiesForm");
  var saveBtn = $("savePropertiesBtn");
  var saveRestartBtn = $("saveRestartBtn");
  var hasChanges = false;

  async function loadProperties() {
    try {
      const res = await fetch('/api/server/properties');
      const props = await res.json();
      
      for (let key in props) {
        let el = $(key);
        if (el) {
          if (el.type === 'checkbox') el.checked = props[key] === 'true';
          else el.value = props[key];
        }
      }
    } catch (e) {
      console.error("Error cargando propiedades:", e);
    }
  }

  async function saveProperties(silent = false) {
    const formData = new FormData(propForm);
    const data = {};
    
    // Recoger todos los campos del formulario
    const inputs = propForm.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        if(input.id) {
            if(input.type === 'checkbox') data[input.id] = input.checked ? 'true' : 'false';
            else data[input.id] = input.value;
        }
    });

    try {
      const res = await fetch('/api/server/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        hasChanges = false;
        if (!silent) alert("Propiedades guardadas correctamente.");
        return true;
      }
    } catch (e) {
      console.error("Error guardando:", e);
      return false;
    }
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      await saveProperties();
      saveBtn.disabled = false;
    });
  }

  if (saveRestartBtn) {
    saveRestartBtn.addEventListener("click", async () => {
      saveRestartBtn.disabled = true;
      const ok = await saveProperties(true);
      if (ok) {
        await fetch('/api/server/restart', { method: 'POST' });
        alert("Propiedades guardadas. Reiniciando servidor...");
      }
      saveRestartBtn.disabled = false;
    });
  }

  propForm.addEventListener("change", () => {
    hasChanges = true;
  });

  window.addEventListener("beforeunload", (e) => {
    if (hasChanges) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  loadProperties();
});

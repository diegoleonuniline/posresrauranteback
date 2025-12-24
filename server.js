const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Config AppSheet
const APPSHEET_APP_ID = "73c158ba-ee52-46ac-bb8a-d5de9288dba7";
const APPSHEET_API_KEY = "V2-VLqAc-tCJpO-rs1pU-XT4fq-IMOyy-jOlUq-YbEyf-i6rEk";
const APPSHEET_BASE_URL = `https://api.appsheet.com/api/v2/apps/${APPSHEET_APP_ID}/tables/`;

app.use(cors());
app.use(express.json());

// Headers AppSheet
function getHeaders() {
  return {
    "ApplicationAccessKey": APPSHEET_API_KEY,
    "Content-Type": "application/json"
  };
}

// Payload Find
function buildFindPayload(selector) {
  const payload = {
    Action: "Find",
    Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
    Rows: []
  };
  if (selector) payload.Properties.Selector = selector;
  return payload;
}

// AppSheet Find
async function appSheetFind(tableName, selector) {
  const res = await fetch(APPSHEET_BASE_URL + tableName + "/Action", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(buildFindPayload(selector))
  });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// AppSheet Add
async function appSheetAdd(tableName, row) {
  const payload = {
    Action: "Add",
    Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
    Rows: [row]
  };
  const res = await fetch(APPSHEET_BASE_URL + tableName + "/Action", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!text) return { Rows: [] };
  return JSON.parse(text);
}

// AppSheet Edit
async function appSheetEdit(tableName, row) {
  const payload = {
    Action: "Edit",
    Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
    Rows: [row]
  };
  const res = await fetch(APPSHEET_BASE_URL + tableName + "/Action", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  return res.status === 200;
}

// AppSheet Delete
async function appSheetDelete(tableName, id) {
  const payload = {
    Action: "Delete",
    Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
    Rows: [{ ID: id }]
  };
  const res = await fetch(APPSHEET_BASE_URL + tableName + "/Action", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  return res.status === 200;
}

// ========== ENDPOINTS ==========

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'POS Backend Running' });
});

// Obtener datos menú
app.get('/api/menu', async (req, res) => {
  try {
    const [rawCategorias, rawProductos, rawExtras, rawProductoExtras] = await Promise.all([
      appSheetFind("Categorias"),
      appSheetFind("Productos"),
      appSheetFind("Extras"),
      appSheetFind("ProductoExtras")
    ]);

    const categorias = rawCategorias.map(r => ({
      id: r.ID,
      nombre: r.Nombre || r.Categoria || "",
      icono: r.Icono || "📦",
      orden: parseInt(r.Orden) || 99
    })).sort((a, b) => a.orden - b.orden);

    const productos = rawProductos
      .filter(r => r.Disponible && r.Disponible.toUpperCase() === "SI")
      .map(r => {
        let imagen = "";
        const urlProducto = r.URL_Producto || "";
        if (urlProducto && urlProducto.includes("fileName=")) {
          const fileName = urlProducto.split("fileName=")[1];
          if (fileName && fileName.trim() && !fileName.startsWith("&")) {
            imagen = urlProducto;
          }
        }
        return {
          id: r.ID,
          nombre: r.Nombre,
          descripcion: r.Descripcion || "",
          precio: parseFloat(r.Precio) || 0,
          categoria: r.Categoria,
          imagen,
          tiempo: r.TiempoPreparacion || "15 min",
          tieneExtras: r.TieneExtras && r.TieneExtras.toUpperCase() === "SI",
          destacado: r.Destacado && r.Destacado.toLowerCase() === "si"
        };
      });

    const extras = rawExtras
      .filter(r => r.Disponible && r.Disponible.toUpperCase() === "SI")
      .map(r => ({
        id: r.ID,
        nombre: r.Nombre,
        precio: parseFloat(r.Precio) || 0
      }));

    const productoExtras = rawProductoExtras.map(r => ({
      productoId: r.ProductoID,
      extraId: r.ExtraID
    }));

    res.json({ categorias, productos, extras, productoExtras });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener mesas y cuentas
app.get('/api/mesas-cuentas', async (req, res) => {
  try {
    const [rawMesas, rawVentas, rawDetalles] = await Promise.all([
      appSheetFind("Mesas"),
      appSheetFind("Ventas", 'Filter(Ventas, [Estado] = "Abierto")'),
      appSheetFind("DetalleVentas", 'Filter(DetalleVentas, [Estado] <> "Cancelado")')
    ]);

    const detallesPorFolio = {};
    rawDetalles.forEach(d => {
      if (!detallesPorFolio[d.Folio]) detallesPorFolio[d.Folio] = [];
      detallesPorFolio[d.Folio].push({
        id: d.ID,
        productoId: d.ProductoID,
        nombre: d.NombreProducto || "",
        cantidad: parseInt(d.Cantidad) || 1,
        precio: parseFloat(d.PrecioUnitario) || 0,
        extras: d.Extras || "",
        extrasTotal: parseFloat(d.ExtrasTotal) || 0,
        subtotal: parseFloat(d.Subtotal) || 0,
        notas: d.Notas || "",
        estado: d.Estado || "Activo"
      });
    });

    const ventasPorMesa = {};
    const cuentasAbiertas = [];

    rawVentas.forEach(v => {
      const cuenta = {
        folio: v.Folio,
        mesaId: v.MesaID || "",
        cliente: v.NombreCliente || "Mostrador",
        clienteId: v.ClienteID || "",
        tipoServicio: v.TipoServicio || "Local",
        direccion: v.DireccionEntrega || "",
        total: parseFloat(v.Total) || 0,
        hora: v.Hora || "",
        meseroId: v.Mesero || "",
        productos: detallesPorFolio[v.Folio] || []
      };
      cuentasAbiertas.push(cuenta);
      if (v.MesaID) ventasPorMesa[v.MesaID] = cuenta;
    });

    const mesas = rawMesas.map((m, idx) => {
      const cuenta = ventasPorMesa[m.ID];
      return {
        id: m.ID,
        numero: m.Numero || m.numero || idx + 1,
        capacidad: m.Capacidad || m.capacidad || 4,
        ubicacion: m.Ubicacion || m.ubicacion || "",
        estado: cuenta ? "Ocupada" : "Disponible",
        folio: cuenta ? cuenta.folio : null,
        total: cuenta ? cuenta.total : 0,
        hora: cuenta ? cuenta.hora : "",
        cuenta: cuenta || null
      };
    });

    res.json({ mesas, cuentas: cuentasAbiertas });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) {
      return res.json({ success: false, mensaje: "Ingresa correo y contraseña" });
    }

    const usuarios = await appSheetFind("Usuarios", `Filter(Usuarios, LOWER([Correo]) = LOWER("${correo.trim()}"))`);
    if (usuarios.length === 0) {
      return res.json({ success: false, mensaje: "Usuario no encontrado" });
    }

    const usuario = usuarios[0];
    if (usuario.Contrasena !== contrasena) {
      return res.json({ success: false, mensaje: "Contraseña incorrecta" });
    }
    if (usuario.Activo && usuario.Activo.toUpperCase() !== "SI") {
      return res.json({ success: false, mensaje: "Usuario inactivo" });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
    await appSheetEdit("Usuarios", { ID: usuario.ID, UltimoAcceso: timestamp });

    res.json({
      success: true,
      usuario: {
        id: usuario.ID,
        nombre: usuario.Nombre || "",
        correo: usuario.Correo || "",
        rol: usuario.Rol || "Cajero"
      }
    });
  } catch (error) {
    res.json({ success: false, mensaje: "Error del servidor" });
  }
});

// Meseros
app.get('/api/meseros', async (req, res) => {
  try {
    const usuarios = await appSheetFind("Usuarios", 'Filter(Usuarios, [Activo] = "Si")');
    const meseros = usuarios.map(u => ({
      id: u.ID,
      nombre: u.Nombre || ""
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    res.json(meseros);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Métodos de pago
app.get('/api/metodos-pago', async (req, res) => {
  try {
    const metodos = await appSheetFind("MetodosPago");
    res.json(metodos.map(m => ({
      id: m.Id || m.ID,
      nombre: m.Metodo || m.Nombre || ""
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clientes
app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await appSheetFind("Clientes");
    res.json(clientes.map(c => ({
      id: c.ID,
      nombre: c.Nombre || "",
      telefono: c.Telefono || "",
      correo: c.Correo || "",
      puntos: parseInt(c.Puntos) || 0
    })).sort((a, b) => a.nombre.localeCompare(b.nombre)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Estadísticas hoy
app.get('/api/estadisticas-hoy', async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const ventas = await appSheetFind("Ventas", `Filter(Ventas, [Fecha] = "${hoy}" AND [Estado] = "Cerrado")`);
    const total = ventas.reduce((sum, v) => sum + (parseFloat(v.Total) || 0), 0);
    res.json({ cantidad: ventas.length, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Abrir cuenta mesa
app.post('/api/abrir-cuenta', async (req, res) => {
  try {
    const { mesaId, meseroId, usuarioId } = req.body;
    const now = new Date();
    const fecha = now.toISOString().split('T')[0];
    const hora = now.toTimeString().split(' ')[0];

    const result = await appSheetAdd("Ventas", {
      Fecha: fecha,
      Hora: hora,
      MesaID: mesaId || "",
      Mesero: meseroId || "",
      TipoServicio: "Local",
      Estado: "Abierto",
      Total: "0",
      UsuarioAtendio: usuarioId || ""
    });

    if (result.Rows && result.Rows.length > 0) {
      res.json({ success: true, folio: result.Rows[0].Folio });
    } else {
      res.json({ success: false, mensaje: "Error al crear cuenta" });
    }
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Agregar productos batch
app.post('/api/agregar-productos', async (req, res) => {
  try {
    const { folio, productos, meseroId, usuarioId } = req.body;
    if (!productos || productos.length === 0) {
      return res.json({ success: false, mensaje: "Sin productos" });
    }

    const rows = productos.map(p => ({
      Folio: folio,
      ProductoID: p.productoId,
      NombreProducto: p.nombre,
      Cantidad: String(p.cantidad),
      PrecioUnitario: String(p.precio),
      Extras: p.extrasIds || "",
      ExtrasTotal: String(p.extrasTotal || 0),
      Subtotal: String(p.subtotal),
      Notas: p.notas || "",
      MeseroActual: meseroId || "",
      Estado: "Activo",
      "Registrado por": usuarioId || ""
    }));

    const payload = {
      Action: "Add",
      Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
      Rows: rows
    };

    const response = await fetch(APPSHEET_BASE_URL + "DetalleVentas/Action", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.Rows && result.Rows.length > 0) {
      res.json({ success: true, cantidad: result.Rows.length });
    } else {
      res.json({ success: false, mensaje: "No se guardaron productos" });
    }
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Cerrar cuenta
app.post('/api/cerrar-cuenta', async (req, res) => {
  try {
    const { folio, pagos, propina, usuarioId } = req.body;
    const now = new Date();
    const fecha = now.toISOString().split('T')[0];
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

    const ventas = await appSheetFind("Ventas", `Filter(Ventas, [Folio] = "${folio}")`);
    const mesaId = ventas.length > 0 ? (ventas[0].MesaID || "") : "";
    const ventaTotal = ventas.length > 0 ? (parseFloat(ventas[0].Total) || 0) : 0;

    for (let i = 0; i < pagos.length; i++) {
      const pago = pagos[i];
      if (pago.monto > 0) {
        // Si es efectivo, enviar solo el total, no lo recibido
        let montoReal = pago.monto;
        if (pago.metodoId === "EFE" || pago.metodo === "Efectivo") {
          montoReal = Math.min(pago.monto, ventaTotal);
        }

        await appSheetAdd("Pagos", {
          Folio: folio,
          MetodoPago: pago.metodoId,
          Monto: String(montoReal),
          Propina: String(i === 0 ? (propina || 0) : 0),
          Fecha: fecha,
          Timestamp: timestamp,
          "Registrador por": usuarioId || ""
        });
      }
    }

    await appSheetEdit("Ventas", { Folio: folio, Estado: "Cerrado" });

    if (mesaId) {
      await appSheetEdit("Mesas", { ID: mesaId, Estado: "Disponible" });
    }

    res.json({ success: true, folio });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Cancelar cuenta
app.post('/api/cancelar-cuenta', async (req, res) => {
  try {
    const { folio } = req.body;
    const ventas = await appSheetFind("Ventas", `Filter(Ventas, [Folio] = "${folio}")`);
    const mesaId = ventas.length > 0 ? (ventas[0].MesaID || "") : "";

    await appSheetEdit("Ventas", { Folio: folio, Estado: "Cancelado" });

    if (mesaId) {
      await appSheetEdit("Mesas", { ID: mesaId, Estado: "Disponible" });
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Registrar venta POS (venta rápida)
app.post('/api/registrar-venta', async (req, res) => {
  try {
    const data = req.body;
    const now = new Date();
    const fecha = now.toISOString().split('T')[0];
    const hora = now.toTimeString().split(' ')[0];
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

    let subtotalProductos = data.productos.reduce((sum, p) => sum + p.subtotal, 0);
    const costoEnvio = data.tipoServicio === "Domicilio" ? (data.costoEnvio || 0) : 0;
    
    let descuento = 0;
    let cuponId = "";
    if (data.cupon && data.cupon.id) {
      descuento = Math.round(subtotalProductos * (data.cupon.descuento / 100));
      cuponId = data.cupon.id;
    }

    const total = subtotalProductos + costoEnvio - descuento;

    const resultVenta = await appSheetAdd("Ventas", {
      Fecha: fecha,
      Hora: hora,
      ClienteID: data.clienteId || "",
      NombreCliente: data.nombreCliente || "Mostrador",
      TelefonoCliente: String(data.telefono || ""),
      DireccionEntrega: data.direccionId || "",
      TipoServicio: data.tipoServicio || "Local",
      MesaID: data.mesaId || "",
      Mesero: data.meseroId || "",
      Observaciones: data.observaciones || "",
      CostoEnvio: String(costoEnvio),
      CoordenadasEntrega: data.coordenadas || "",
      CuponAplicado: cuponId,
      Descuento: String(descuento),
      EstadoDelivery: data.tipoServicio === "Domicilio" ? "Solicitado" : "",
      Estado: "Cerrado",
      UsuarioAtendio: data.usuarioId || ""
    });

    if (!resultVenta.Rows || resultVenta.Rows.length === 0) {
      throw new Error("AppSheet no retornó la venta");
    }

    const folio = resultVenta.Rows[0].Folio;

    // Agregar detalles
    for (const p of data.productos) {
      await appSheetAdd("DetalleVentas", {
        Folio: folio,
        ProductoID: p.productoId,
        NombreProducto: p.nombre,
        Cantidad: String(p.cantidad),
        PrecioUnitario: String(p.precio),
        Extras: p.extrasIds || "",
        ExtrasTotal: String(p.extrasTotal || 0),
        Subtotal: String(p.subtotal),
        Notas: p.notas || "",
        "Registrado por": data.usuarioId || ""
      });
    }

    // Agregar pagos
    if (data.pagos && data.pagos.length > 0) {
      for (let i = 0; i < data.pagos.length; i++) {
        const pago = data.pagos[i];
        if (pago.monto > 0) {
          // Si es efectivo, enviar solo el total, no lo recibido
          let montoReal = pago.monto;
          if (pago.metodoId === "EFE" || pago.metodo === "Efectivo") {
            montoReal = Math.min(pago.monto, total);
          }

          await appSheetAdd("Pagos", {
            Folio: folio,
            MetodoPago: pago.metodoId,
            Monto: String(montoReal),
            Propina: String(i === 0 ? (data.propina || 0) : 0),
            Fecha: fecha,
            Timestamp: timestamp,
            "Registrador por": data.usuarioId || ""
          });
        }
      }
    }

    res.json({ success: true, folio, total, descuento });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Agregar cliente
app.post('/api/agregar-cliente', async (req, res) => {
  try {
    const datos = req.body;
    const existentes = await appSheetFind("Clientes");
    const telExiste = existentes.some(c => (c.Telefono || "") === datos.telefono);

    if (telExiste) {
      return res.json({ success: false, mensaje: "Teléfono ya registrado" });
    }

    const result = await appSheetAdd("Clientes", {
      Nombre: datos.nombre,
      Telefono: datos.telefono,
      Correo: datos.correo || "",
      Direccion: datos.direccion || "",
      Contraseña: datos.telefono,
      Puntos: 0,
      Activo: "SI"
    });

    if (result.Rows && result.Rows.length > 0) {
      const c = result.Rows[0];
      res.json({
        success: true,
        cliente: {
          id: c.ID,
          nombre: c.Nombre || "",
          telefono: c.Telefono || "",
          correo: c.Correo || "",
          direccion: c.Direccion || "",
          puntos: 0
        }
      });
    } else {
      res.json({ success: false, mensaje: "Error al registrar" });
    }
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Direcciones cliente
app.get('/api/direcciones/:clienteId', async (req, res) => {
  try {
    const data = await appSheetFind("DireccionesCliente", `Filter(DireccionesCliente, [Clientes] = "${req.params.clienteId}")`);
    res.json(data.map(d => ({
      id: d.ID,
      direccion: d.Direccion,
      maps: d.Maps || ""
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agregar dirección
app.post('/api/agregar-direccion', async (req, res) => {
  try {
    const { clienteId, direccion, maps } = req.body;
    const result = await appSheetAdd("DireccionesCliente", {
      Clientes: clienteId,
      Direccion: direccion,
      Maps: maps || ""
    });

    if (result.Rows && result.Rows.length > 0) {
      res.json({ success: true, id: result.Rows[0].ID });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Validar cupón
app.post('/api/validar-cupon', async (req, res) => {
  try {
    const { codigo, clienteId } = req.body;
    const cupones = await appSheetFind("Cupones", `Filter(Cupones, LOWER([CodigoCupon]) = LOWER("${codigo}"))`);

    if (cupones.length === 0) {
      return res.json({ success: false, mensaje: "Cupón no válido" });
    }

    const c = cupones[0];
    const hoy = new Date();

    if (c.Vigencia) {
      const vigencia = new Date(c.Vigencia);
      if (hoy > vigencia) {
        return res.json({ success: false, mensaje: "Cupón expirado" });
      }
    }

    if (clienteId) {
      const usosCliente = await appSheetFind("Ventas", `Filter(Ventas, [CuponAplicado] = "${c.Id}" AND [ClienteID] = "${clienteId}")`);
      if (usosCliente.length > 0) {
        return res.json({ success: false, mensaje: "Cliente ya usó este cupón" });
      }
    }

    res.json({
      success: true,
      cupon: {
        id: c.Id,
        nombre: c.NombreCupon,
        descuento: parseFloat(c["Descuento%"]) || 0,
        codigo: c.CodigoCupon
      }
    });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Actualizar detalles batch
app.post('/api/actualizar-detalles', async (req, res) => {
  try {
    const { cambios } = req.body;
    if (!cambios || cambios.length === 0) {
      return res.json({ success: true, mensaje: "Sin cambios" });
    }

    const rows = cambios.map(c => ({
      ID: c.id,
      Cantidad: String(c.cantidad),
      Subtotal: String(c.subtotal)
    }));

    const payload = {
      Action: "Edit",
      Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
      Rows: rows
    };

    const response = await fetch(APPSHEET_BASE_URL + "DetalleVentas/Action", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });

    res.json({ success: response.status === 200, cantidad: rows.length });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Cancelar detalles batch
app.post('/api/cancelar-detalles', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || ids.length === 0) {
      return res.json({ success: true });
    }

    const rows = ids.map(id => ({ ID: id, Estado: "Cancelado" }));

    const payload = {
      Action: "Edit",
      Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
      Rows: rows
    };

    const response = await fetch(APPSHEET_BASE_URL + "DetalleVentas/Action", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });

    res.json({ success: response.status === 200 });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// Cuenta por folio
app.get('/api/cuenta/:folio', async (req, res) => {
  try {
    const folio = req.params.folio;
    const [ventas, detalles] = await Promise.all([
      appSheetFind("Ventas", `Filter(Ventas, [Folio] = "${folio}")`),
      appSheetFind("DetalleVentas", `Filter(DetalleVentas, [Folio] = "${folio}")`)
    ]);

    if (ventas.length === 0) {
      return res.json(null);
    }

    const venta = ventas[0];
    const productos = detalles
      .filter(d => (d.Estado || "Activo") !== "Cancelado")
      .map(d => ({
        id: d.ID,
        productoId: d.ProductoID,
        nombre: d.NombreProducto || "",
        cantidad: parseInt(d.Cantidad) || 1,
        precio: parseFloat(d.PrecioUnitario) || 0,
        extras: d.Extras || "",
        extrasTotal: parseFloat(d.ExtrasTotal) || 0,
        subtotal: parseFloat(d.Subtotal) || 0,
        notas: d.Notas || "",
        estado: d.Estado || "Activo"
      }));

    res.json({
      folio: venta.Folio,
      mesaId: venta.MesaID || "",
      cliente: venta.NombreCliente || "Mostrador",
      clienteId: venta.ClienteID || "",
      tipoServicio: venta.TipoServicio || "Local",
      direccion: venta.DireccionEntrega || "",
      total: parseFloat(venta.Total) || 0,
      hora: venta.Hora || "",
      productos,
      meseroId: venta.Mesero || ""
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Historial ventas
app.get('/api/historial', async (req, res) => {
  try {
    const limite = parseInt(req.query.limite) || 50;
    const ventas = await appSheetFind("Ventas");

    ventas.sort((a, b) => {
      const fechaA = new Date(a.Fecha + " " + (a.Hora || "00:00:00"));
      const fechaB = new Date(b.Fecha + " " + (b.Hora || "00:00:00"));
      return fechaB - fechaA;
    });

    res.json(ventas.slice(0, limite).map(v => ({
      folio: v.Folio,
      fecha: v.Fecha,
      hora: v.Hora,
      cliente: v.NombreCliente || "Mostrador",
      tipoServicio: v.TipoServicio || "Local",
      total: parseFloat(v.Total) || 0,
      estado: v.Estado || "Cerrado"
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

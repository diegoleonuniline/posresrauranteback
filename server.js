// REEMPLAZA COMPLETAMENTE server.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

// MySQL Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'u951308636_comody',
  password: process.env.DB_PASSWORD || 'Leon2018#',
  database: process.env.DB_NAME || 'u951308636_comody',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

// Config AppSheet (SOLO PARA PRODUCTOS)
const APPSHEET_APP_ID = "73c158ba-ee52-46ac-bb8a-d5de9288dba7";
const APPSHEET_API_KEY = "V2-VLqAc-tCJpO-rs1pU-XT4fq-IMOyy-jOlUq-YbEyf-i6rEk";
const APPSHEET_BASE_URL = `https://api.appsheet.com/api/v2/apps/${APPSHEET_APP_ID}/tables/`;

app.use(cors({
  origin: ['https://diegoleonuniline.github.io', 'http://localhost:3000', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json());

function getHeaders() {
  return {
    "ApplicationAccessKey": APPSHEET_API_KEY,
    "Content-Type": "application/json"
  };
}

function buildFindPayload(selector) {
  const payload = {
    Action: "Find",
    Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
    Rows: []
  };
  if (selector) payload.Properties.Selector = selector;
  return payload;
}

async function appSheetFind(tableName, selector) {
  const res = await fetch(APPSHEET_BASE_URL + tableName + "/Action", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(buildFindPayload(selector))
  });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// ========== FUNCIONES AUXILIARES ==========

async function generarFolio() {
  const [rows] = await pool.query("SELECT folio FROM ventas ORDER BY folio DESC LIMIT 1");
  if (rows.length === 0) return "VEN0001";
  const ultimo = rows[0].folio;
  const num = parseInt(ultimo.substring(3)) + 1;
  return "VEN" + num.toString().padStart(4, '0');
}

// ========== ENDPOINTS ==========

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'POS Backend Running - MySQL + AppSheet' });
});

// PRODUCTOS - APPSHEET
app.get('/api/menu', async (req, res) => {
  try {
    const [rawProductos, rawExtras, rawProductoExtras] = await Promise.all([
      appSheetFind("Productos"),
      appSheetFind("Extras"),
      appSheetFind("ProductoExtras")
    ]);

    const [categorias] = await pool.query("SELECT * FROM categorias WHERE activo = 'SI' ORDER BY icono");

    const categoriasFormat = categorias.map(r => ({
      id: r.id,
      nombre: r.nombre || "",
      icono: r.icono || "📦",
      orden: 99
    }));

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

    res.json({ categorias: categoriasFormat, productos, extras, productoExtras });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// MESAS Y CUENTAS - MYSQL
app.get('/api/mesas-cuentas', async (req, res) => {
  try {
    const [mesas] = await pool.query("SELECT * FROM mesas");
    const hoy = new Date().toISOString().slice(0, 10);
    
    const [ventas] = await pool.query(
      `SELECT * FROM ventas WHERE estado != 'Cancelado' AND DATE(fecha) = ?`,
      [hoy]
    );
    
    const folios = ventas.map(v => v.folio);
    let detalles = [];
    
    if (folios.length > 0) {
      [detalles] = await pool.query(
        `SELECT * FROM detalleventas WHERE folio IN (?) AND estado != 'Cancelado'`,
        [folios]
      );
    }
    
    const detallesPorFolio = {};
    detalles.forEach(d => {
      if (!detallesPorFolio[d.folio]) detallesPorFolio[d.folio] = [];
      detallesPorFolio[d.folio].push({
        id: d.id,
        productoId: d.productoid,
        nombre: d.nombreproducto || "",
        cantidad: parseInt(d.cantidad) || 1,
        precio: parseFloat(d.preciounitario) || 0,
        extras: d.extras || "",
        extrasTotal: parseFloat(d.extrastotal) || 0,
        subtotal: parseFloat(d.subtotal) || 0,
        notas: d.notas || "",
        estado: d.estado || "Activo"
      });
    });

    const ventasPorMesa = {};
    const cuentasAbiertas = [];

    ventas.forEach(v => {
      const cuenta = {
        folio: v.folio,
        mesaId: v.mesaid || "",
        cliente: v.nombrecliente || "Mostrador",
        clienteId: v.clienteid || "",
        tipoServicio: v.tiposervicio || "Local",
        direccion: v.direccionentrega || "",
        total: parseFloat(v.total) || 0,
        hora: v.hora || "",
        meseroId: v.mesero || "",
        estado: v.estado || "Abierto",
        productos: detallesPorFolio[v.folio] || []
      };
      cuentasAbiertas.push(cuenta);
      if (v.mesaid) ventasPorMesa[v.mesaid] = cuenta;
    });

    const mesasFormat = mesas.map((m, idx) => {
      const cuenta = ventasPorMesa[m.id];
      return {
        id: m.id,
        numero: m.numero || idx + 1,
        capacidad: m.capacidad || 4,
        ubicacion: m.ubicacion || "",
        estado: cuenta ? "Ocupada" : "Disponible",
        folio: cuenta ? cuenta.folio : null,
        total: cuenta ? cuenta.total : 0,
        hora: cuenta ? cuenta.hora : "",
        cuenta: cuenta || null
      };
    });

    res.json({ mesas: mesasFormat, cuentas: cuentasAbiertas });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// LOGIN - MYSQL
app.post('/api/login', async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) {
      return res.json({ success: false, mensaje: "Ingresa correo y contraseña" });
    }

    const [usuarios] = await pool.query(
      "SELECT * FROM usuarios WHERE LOWER(correo) = LOWER(?) LIMIT 1",
      [correo.trim()]
    );

    if (usuarios.length === 0) {
      return res.json({ success: false, mensaje: "Usuario no encontrado" });
    }

    const usuario = usuarios[0];
    if (usuario.contrasena !== contrasena) {
      return res.json({ success: false, mensaje: "Contraseña incorrecta" });
    }
    if (usuario.activo && usuario.activo.toUpperCase() !== "SI") {
      return res.json({ success: false, mensaje: "Usuario inactivo" });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.query("UPDATE usuarios SET ultimoacceso = ? WHERE id = ?", [now, usuario.id]);

    res.json({
      success: true,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre || "",
        correo: usuario.correo || "",
        rol: usuario.rol || "Cajero"
      }
    });
  } catch (error) {
    res.json({ success: false, mensaje: "Error del servidor" });
  }
});

// MESEROS - MYSQL
app.get('/api/meseros', async (req, res) => {
  try {
    const [usuarios] = await pool.query("SELECT * FROM usuarios WHERE activo = 'Si'");
    const meseros = usuarios.map(u => ({
      id: u.id,
      nombre: u.nombre || ""
    })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    res.json(meseros);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// METODOS PAGO - MYSQL
app.get('/api/metodos-pago', async (req, res) => {
  try {
    const [metodos] = await pool.query("SELECT * FROM metodospago");
    res.json(metodos.map(m => ({
      id: m.id,
      nombre: m.metodo || ""
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CLIENTES - MYSQL
app.get('/api/clientes', async (req, res) => {
  try {
    const [clientes] = await pool.query("SELECT * FROM clientes");
    res.json(clientes.map(c => ({
      id: c.id,
      nombre: c.nombre || "",
      telefono: c.telefono || "",
      correo: c.correo || "",
      puntos: parseInt(c.puntos) || 0
    })).sort((a, b) => a.nombre.localeCompare(b.nombre)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ESTADISTICAS HOY - MYSQL
app.get('/api/estadisticas-hoy', async (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const [ventas] = await pool.query(
      "SELECT COUNT(*) as cantidad, SUM(CAST(total AS DECIMAL(10,2))) as total FROM ventas WHERE DATE(fecha) = ? AND estado = 'Cerrado'",
      [hoy]
    );
    res.json({ 
      cantidad: ventas[0].cantidad || 0, 
      total: parseFloat(ventas[0].total) || 0 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ABRIR CUENTA - MYSQL
app.post('/api/abrir-cuenta', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const { mesaId, meseroId, usuarioId } = req.body;
    const folio = await generarFolio();
    const now = new Date();
    const fecha = now.toISOString().slice(0, 19).replace('T', ' ');
    
    await conn.query(
      `INSERT INTO ventas (folio, fecha, mesaid, mesero, tiposervicio, estado, usuarioatendio) 
       VALUES (?, ?, ?, ?, 'Local', 'Abierto', ?)`,
      [folio, fecha, mesaId || null, meseroId || null, usuarioId || null]
    );
    
    await conn.commit();
    res.json({ success: true, folio });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// AGREGAR PRODUCTOS - MYSQL
app.post('/api/agregar-productos', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const { folio, productos, meseroId, usuarioId } = req.body;
    if (!productos || productos.length === 0) {
      return res.json({ success: false, mensaje: "Sin productos" });
    }

    for (const p of productos) {
      await conn.query(
        `INSERT INTO detalleventas (folio, productoid, nombreproducto, cantidad, preciounitario, extras, extrastotal, subtotal, notas, meseroactual, estado, registrado_por) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?)`,
        [
          folio,
          p.productoId,
          p.nombre,
          p.cantidad,
          p.precio,
          p.extrasIds || "",
          p.extrasTotal || 0,
          p.subtotal,
          p.notas || "",
          meseroId || null,
          usuarioId || null
        ]
      );
    }

    await conn.commit();
    res.json({ success: true, cantidad: productos.length });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// CERRAR CUENTA - MYSQL
app.post('/api/cerrar-cuenta', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const { folio, pagos, propina, usuarioId } = req.body;
    const now = new Date();
    const fecha = now.toISOString().slice(0, 19).replace('T', ' ');

    const [ventas] = await conn.query("SELECT * FROM ventas WHERE folio = ?", [folio]);
    const mesaId = ventas.length > 0 ? ventas[0].mesaid : null;
    const ventaTotal = ventas.length > 0 ? parseFloat(ventas[0].total || 0) : 0;

    for (let i = 0; i < pagos.length; i++) {
      const pago = pagos[i];
      if (pago.monto > 0) {
        let montoReal = pago.monto;
        if (pago.metodoId === "EFE" || pago.metodo === "Efectivo") {
          montoReal = Math.min(pago.monto, ventaTotal);
        }

        await conn.query(
          `INSERT INTO pagos (folio, metodopago, monto, propina, fecha, timestamp, registrador_por) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            folio,
            pago.metodoId,
            montoReal,
            i === 0 ? (propina || 0) : 0,
            fecha,
            fecha,
            usuarioId || null
          ]
        );
      }
    }

    await conn.query("UPDATE ventas SET estado = 'Cerrado' WHERE folio = ?", [folio]);

    if (mesaId) {
      await conn.query("UPDATE mesas SET estado = 'Disponible' WHERE id = ?", [mesaId]);
    }

    await conn.commit();
    res.json({ success: true, folio });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// CANCELAR CUENTA - MYSQL
app.post('/api/cancelar-cuenta', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const { folio } = req.body;
    const [ventas] = await conn.query("SELECT mesaid FROM ventas WHERE folio = ?", [folio]);
    const mesaId = ventas.length > 0 ? ventas[0].mesaid : null;

    await conn.query("UPDATE ventas SET estado = 'Cancelado' WHERE folio = ?", [folio]);

    if (mesaId) {
      await conn.query("UPDATE mesas SET estado = 'Disponible' WHERE id = ?", [mesaId]);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// REGISTRAR VENTA POS - MYSQL
app.post('/api/registrar-venta', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const data = req.body;
    const folio = await generarFolio();
    const now = new Date();
    const fecha = now.toISOString().slice(0, 19).replace('T', ' ');

    let subtotalProductos = data.productos.reduce((sum, p) => sum + p.subtotal, 0);
    const costoEnvio = data.tipoServicio === "Domicilio" ? (data.costoEnvio || 0) : 0;
    
    let descuento = 0;
    let cuponId = "";
    if (data.cupon && data.cupon.id) {
      descuento = Math.round(subtotalProductos * (data.cupon.descuento / 100));
      cuponId = data.cupon.id;
    }

    const total = subtotalProductos + costoEnvio - descuento;

    await conn.query(
      `INSERT INTO ventas (folio, fecha, clienteid, nombrecliente, telefonocliente, direccionentrega, tiposervicio, mesaid, mesero, observaciones, costoenvio, coordenadasentrega, cuponaplicado, descuento, estadodelivery, estado, usuarioatendio) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cerrado', ?)`,
      [
        folio,
        fecha,
        data.clienteId || null,
        data.nombreCliente || "Mostrador",
        data.telefono || "",
        data.direccionId || null,
        data.tipoServicio || "Local",
        data.mesaId || null,
        data.meseroId || null,
        data.observaciones || "",
        costoEnvio,
        data.coordenadas || "",
        cuponId || null,
        descuento,
        data.tipoServicio === "Domicilio" ? "Solicitado" : "",
        data.usuarioId || null
      ]
    );

    for (const p of data.productos) {
      await conn.query(
        `INSERT INTO detalleventas (folio, productoid, nombreproducto, cantidad, preciounitario, extras, extrastotal, subtotal, notas, registrado_por) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          folio,
          p.productoId,
          p.nombre,
          p.cantidad,
          p.precio,
          p.extrasIds || "",
          p.extrasTotal || 0,
          p.subtotal,
          p.notas || "",
          data.usuarioId || null
        ]
      );
    }

    if (data.pagos && data.pagos.length > 0) {
      for (let i = 0; i < data.pagos.length; i++) {
        const pago = data.pagos[i];
        if (pago.monto > 0) {
          let montoReal = pago.monto;
          if (pago.metodoId === "EFE" || pago.metodo === "Efectivo") {
            montoReal = Math.min(pago.monto, total);
          }

          await conn.query(
            `INSERT INTO pagos (folio, metodopago, monto, propina, fecha, timestamp, registrador_por) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              folio,
              pago.metodoId,
              montoReal,
              i === 0 ? (data.propina || 0) : 0,
              fecha,
              fecha,
              data.usuarioId || null
            ]
          );
        }
      }
    }

    await conn.commit();
    res.json({ success: true, folio, total, descuento });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// AGREGAR CLIENTE - MYSQL
app.post('/api/agregar-cliente', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const datos = req.body;
    const [existentes] = await conn.query("SELECT * FROM clientes WHERE telefono = ?", [datos.telefono]);

    if (existentes.length > 0) {
      return res.json({ success: false, mensaje: "Teléfono ya registrado" });
    }

    const [result] = await conn.query(
      `INSERT INTO clientes (nombre, telefono, correo, direccion, contrasena, puntos, activo) 
       VALUES (?, ?, ?, ?, ?, 0, 'SI')`,
      [
        datos.nombre,
        datos.telefono,
        datos.correo || "",
        datos.direccion || "",
        datos.telefono
      ]
    );

    const [cliente] = await conn.query("SELECT * FROM clientes WHERE id = ?", [result.insertId]);

    await conn.commit();
    
    res.json({
      success: true,
      cliente: {
        id: cliente[0].id,
        nombre: cliente[0].nombre || "",
        telefono: cliente[0].telefono || "",
        correo: cliente[0].correo || "",
        direccion: cliente[0].direccion || "",
        puntos: 0
      }
    });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// DIRECCIONES CLIENTE - MYSQL
app.get('/api/direcciones/:clienteId', async (req, res) => {
  try {
    const [data] = await pool.query("SELECT * FROM direccionescliente WHERE clientes = ?", [req.params.clienteId]);
    res.json(data.map(d => ({
      id: d.id,
      direccion: d.direccion,
      maps: d.maps || ""
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AGREGAR DIRECCION - MYSQL
app.post('/api/agregar-direccion', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const { clienteId, direccion, maps } = req.body;
    const [result] = await conn.query(
      `INSERT INTO direccionescliente (clientes, direccion, maps) VALUES (?, ?, ?)`,
      [clienteId, direccion, maps || ""]
    );

    await conn.commit();
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// VALIDAR CUPON - MYSQL
app.post('/api/validar-cupon', async (req, res) => {
  try {
    const { codigo, clienteId } = req.body;
    const [cupones] = await pool.query("SELECT * FROM cupones WHERE LOWER(codigocupon) = LOWER(?)", [codigo]);

    if (cupones.length === 0) {
      return res.json({ success: false, mensaje: "Cupón no válido" });
    }

    const c = cupones[0];
    const hoy = new Date();

    if (c.vigencia) {
      const vigencia = new Date(c.vigencia);
      if (hoy > vigencia) {
        return res.json({ success: false, mensaje: "Cupón expirado" });
      }
    }

    if (clienteId) {
      const [usosCliente] = await pool.query(
        "SELECT * FROM ventas WHERE cuponaplicado = ? AND clienteid = ?",
        [c.id, clienteId]
      );
      if (usosCliente.length > 0) {
        return res.json({ success: false, mensaje: "Cliente ya usó este cupón" });
      }
    }

    res.json({
      success: true,
      cupon: {
        id: c.id,
        nombre: c.nombrecupon,
        descuento: parseFloat(c.descuento) || 0,
        codigo: c.codigocupon
      }
    });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// ACTUALIZAR DETALLES - MYSQL
app.post('/api/actualizar-detalles', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const { cambios } = req.body;
    if (!cambios || cambios.length === 0) {
      return res.json({ success: true, mensaje: "Sin cambios" });
    }

    for (const c of cambios) {
      await conn.query(
        "UPDATE detalleventas SET cantidad = ?, subtotal = ? WHERE id = ?",
        [c.cantidad, c.subtotal, c.id]
      );
    }

    await conn.commit();
    res.json({ success: true, cantidad: cambios.length });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// CANCELAR DETALLES - MYSQL
app.post('/api/cancelar-detalles', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const { ids } = req.body;
    if (!ids || ids.length === 0) {
      return res.json({ success: true });
    }

    await conn.query("UPDATE detalleventas SET estado = 'Cancelado' WHERE id IN (?)", [ids]);

    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    res.json({ success: false, mensaje: error.message });
  } finally {
    conn.release();
  }
});

// CUENTA POR FOLIO - MYSQL
app.get('/api/cuenta/:folio', async (req, res) => {
  try {
    const folio = req.params.folio;
    const [ventas] = await pool.query("SELECT * FROM ventas WHERE folio = ?", [folio]);
    const [detalles] = await pool.query("SELECT * FROM detalleventas WHERE folio = ?", [folio]);

    if (ventas.length === 0) {
      return res.json(null);
    }

    const venta = ventas[0];
    const productos = detalles
      .filter(d => (d.estado || "Activo") !== "Cancelado")
      .map(d => ({
        id: d.id,
        productoId: d.productoid,
        nombre: d.nombreproducto || "",
        cantidad: parseInt(d.cantidad) || 1,
        precio: parseFloat(d.preciounitario) || 0,
        extras: d.extras || "",
        extrasTotal: parseFloat(d.extrastotal) || 0,
        subtotal: parseFloat(d.subtotal) || 0,
        notas: d.notas || "",
        estado: d.estado || "Activo"
      }));

    res.json({
      folio: venta.folio,
      mesaId: venta.mesaid || "",
      cliente: venta.nombrecliente || "Mostrador",
      clienteId: venta.clienteid || "",
      tipoServicio: venta.tiposervicio || "Local",
      direccion: venta.direccionentrega || "",
      total: parseFloat(venta.total) || 0,
      hora: venta.hora || "",
      productos,
      meseroId: venta.mesero || ""
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// HISTORIAL VENTAS - MYSQL
app.get('/api/historial', async (req, res) => {
  try {
    const limite = parseInt(req.query.limite) || 50;
    const [ventas] = await pool.query("SELECT * FROM ventas ORDER BY fecha DESC, hora DESC LIMIT ?", [limite]);

    res.json(ventas.map(v => ({
      folio: v.folio,
      fecha: v.fecha,
      hora: v.hora,
      cliente: v.nombrecliente || "Mostrador",
      tipoServicio: v.tiposervicio || "Local",
      total: parseFloat(v.total) || 0,
      estado: v.estado || "Cerrado"
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CERRAR CUENTA SIN COBRO - MYSQL
app.post('/api/cerrar-cuenta-sin-cobro', async (req, res) => {
  try {
    const { folio } = req.body;
    await pool.query("UPDATE ventas SET estado = 'Cerrado' WHERE folio = ?", [folio]);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

// REABRIR CUENTA - MYSQL
app.post('/api/reabrir-cuenta', async (req, res) => {
  try {
    const { folio, pin } = req.body;
    
    const [usuarios] = await pool.query(
      "SELECT * FROM usuarios WHERE pin_de_acceso = ? AND reabrircuenta = 'Si' AND activo = 'Si' LIMIT 1",
      [pin]
    );
    
    if (usuarios.length === 0) {
      return res.json({ success: false, mensaje: "PIN inválido o sin permisos" });
    }
    
    await pool.query("UPDATE ventas SET estado = 'Abierto' WHERE folio = ?", [folio]);
    
    res.json({ success: true, usuario: usuarios[0].nombre });
  } catch (error) {
    res.json({ success: false, mensaje: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} - MySQL + AppSheet`);
});

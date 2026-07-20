const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// 1. MIDDLEWARES
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 5000;
const FILE_DB_PATH = path.join(__dirname, 'backup_productos.json');
const FILE_PEDIDOS_PATH = path.join(__dirname, 'backup_pedidos.json');

// Asegurar archivos JSON de contingencia local
if (!fs.existsSync(FILE_DB_PATH)) fs.writeFileSync(FILE_DB_PATH, JSON.stringify([]));
if (!fs.existsSync(FILE_PEDIDOS_PATH)) fs.writeFileSync(FILE_PEDIDOS_PATH, JSON.stringify([]));

// Conexión a MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tienda_retail_db';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado con éxito a MongoDB'))
    .catch((err) => console.log('⚠️ No se pudo conectar a MongoDB. Usando contingencia local por archivos.', err.message));

// ----------------------------------------------------
// 2. ESQUEMAS DE BASE DE DATOS
// ----------------------------------------------------

// Esquema de Productos
const ProductoSchema = new mongoose.Schema({
    codigo: String,
    vendedor: String,
    nombre: String,
    precio: Number,
    categoria: String,
    imagen: String, 
    descripcion: String,
    stock: Number 
});

const Producto = mongoose.model('Producto', ProductoSchema);

// NUEVO: Esquema de Pedidos / Ventas para Reportes
const PedidoSchema = new mongoose.Schema({
    fecha: { type: Date, default: Date.now },
    cliente: {
        nombre: String,
        telefono: String,
        direccion: String,
        numOperacion: String,
        costoEnvio: Number,
        totalConEnvio: Number
    },
    items: [
        {
            nombre: String,
            cantidad: Number,
            precio: Number
        }
    ],
    estado: { type: String, default: 'Pendiente' } // Pendiente, Entregado, Cancelado
});

const Pedido = mongoose.model('Pedido', PedidoSchema);

// ----------------------------------------------------
// 3. RUTAS DE PRODUCTOS
// ----------------------------------------------------

// API POST: Crear Producto
app.post('/api/productos', async (req, res) => {
    try {
        const datosProducto = {
            codigo: req.body.codigo || 'S/C',
            vendedor: req.body.vendedor || 'Sin asignación',
            nombre: req.body.nombre,
            precio: parseFloat(req.body.precio),
            categoria: req.body.categoria,
            descripcion: req.body.descripcion,
            imagen: req.body.imagen || '',
            stock: parseInt(req.body.stock) || 0
        };

        if (mongoose.connection.readyState === 1) {
            const nuevo = new Producto(datosProducto);
            await nuevo.save();
            return res.status(201).json({ mensaje: "Guardado en MongoDB", producto: nuevo });
        } else {
            const datos = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            const nuevoItem = { _id: Date.now().toString(), ...datosProducto };
            datos.unshift(nuevoItem);
            fs.writeFileSync(FILE_DB_PATH, JSON.stringify(datos, null, 2));
            return res.status(201).json({ mensaje: "Guardado en contingencia Local", producto: nuevoItem });
        }
    } catch (error) {
        console.error("Error al guardar producto:", error);
        res.status(400).json({ error: "Error al guardar el producto" });
    }
});

// API GET: Listar Productos
app.get('/api/productos', async (req, res) => {
    try {
        if (mongoose.connection.readyState === 1) {
            const productos = await Producto.find().sort({ _id: -1 });
            return res.json(productos);
        } else {
            return res.json(JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8')));
        }
    } catch (error) { 
        res.status(500).json({ error: "Error al obtener productos" }); 
    }
});

// API DELETE: Eliminar Producto
app.delete('/api/productos/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (mongoose.connection.readyState === 1) {
            await Producto.findByIdAndDelete(id);
            return res.json({ mensaje: "Producto eliminado de MongoDB con éxito" });
        } else {
            let datos = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            const datosFiltrados = datos.filter(prod => prod.id !== Number(id) && prod._id !== id);
            fs.writeFileSync(FILE_DB_PATH, JSON.stringify(datosFiltrados, null, 2));
            return res.json({ mensaje: "Producto eliminado de contingencia local" });
        }
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar el producto", detalle: error.message });
    }
});

// ----------------------------------------------------
// 4. RUTAS DE VENTAS Y COMPRAS (CON GUARDADO DE HISTORIAL)
// ----------------------------------------------------

// API POST: Procesar Compra y Guardar Registro de Venta
app.post('/api/productos/comprar', async (req, res) => {
    try {
        const { carrito, cliente } = req.body;

        if (!carrito || carrito.length === 0) {
            return res.status(400).json({ error: "El carrito está vacío" });
        }

        if (!cliente || !cliente.nombre || !cliente.direccion || !cliente.telefono) {
            return res.status(400).json({ error: "Faltan datos del cliente o la dirección de envío" });
        }

        // Estructura del pedido a guardar
        const datosPedido = {
            fecha: new Date(),
            cliente: {
                nombre: cliente.nombre,
                telefono: cliente.telefono,
                direccion: cliente.direccion,
                numOperacion: cliente.numOperacion || 'Sin número',
                costoEnvio: parseFloat(cliente.costoEnvio || 0),
                totalConEnvio: parseFloat(cliente.totalConEnvio)
            },
            items: carrito.map(item => ({
                nombre: item.nombre,
                cantidad: parseInt(item.cantidad) || 1,
                precio: parseFloat(item.precio)
            })),
            estado: 'Pendiente'
        };

        if (mongoose.connection.readyState === 1) {
            // 1. Guardar el pedido en MongoDB
            const nuevoPedido = new Pedido(datosPedido);
            await nuevoPedido.save();

            // 2. Restar Stock
            for (let item of carrito) {
                const cantidadARestar = parseInt(item.cantidad) || 1;
                await Producto.updateOne({ nombre: item.nombre }, { $inc: { stock: -cantidadARestar } });
            }

            return res.json({ 
                mensaje: "¡Pedido registrado con éxito!",
                pedidoId: nuevoPedido._id 
            });

        } else {
            // Contingencia Local (JSON)
            let pedidos = JSON.parse(fs.readFileSync(FILE_PEDIDOS_PATH, 'utf-8'));
            const nuevoPedidoLocal = { _id: Date.now().toString(), ...datosPedido };
            pedidos.unshift(nuevoPedidoLocal);
            fs.writeFileSync(FILE_PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

            // Restar stock local
            let datosProd = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            for (let item of carrito) {
                const cantidadARestar = parseInt(item.cantidad) || 1;
                let p = datosProd.find(prod => prod.nombre === item.nombre);
                if (p && p.stock >= cantidadARestar) {
                    p.stock -= cantidadARestar;
                }
            }
            fs.writeFileSync(FILE_DB_PATH, JSON.stringify(datosProd, null, 2));

            return res.json({ 
                mensaje: "¡Pedido registrado localmente!",
                pedidoId: nuevoPedidoLocal._id 
            });
        }

    } catch (error) {
        console.error("Error al procesar compra:", error);
        res.status(500).json({ error: "Error interno al procesar el pedido" });
    }
});

// ----------------------------------------------------
// 5. NUEVAS RUTAS PARA REPORTES Y ADMINISTRACIÓN DE VENTAS
// ----------------------------------------------------

// API GET: Obtener todas las ventas/pedidos realizados
app.get('/api/ventas', async (req, res) => {
    try {
        if (mongoose.connection.readyState === 1) {
            const ventas = await Pedido.find().sort({ fecha: -1 });
            return res.json(ventas);
        } else {
            return res.json(JSON.parse(fs.readFileSync(FILE_PEDIDOS_PATH, 'utf-8')));
        }
    } catch (error) {
        res.status(500).json({ error: "Error al obtener reporte de ventas" });
    }
});

// API GET: Métricas / Resumen de ventas para Reporte Ejecutivo
app.get('/api/ventas/reporte', async (req, res) => {
    try {
        let ventas = [];
        if (mongoose.connection.readyState === 1) {
            ventas = await Pedido.find();
        } else {
            ventas = JSON.parse(fs.readFileSync(FILE_PEDIDOS_PATH, 'utf-8'));
        }

        // Cálculos de métricas
        const totalVentas = ventas.length;
        const ingresosTotales = ventas.reduce((acc, v) => acc + (v.cliente.totalConEnvio || 0), 0);
        
        // Conteo de artículos más vendidos
        const productosVendidos = {};
        ventas.forEach(v => {
            v.items.forEach(item => {
                productosVendidos[item.nombre] = (productosVendidos[item.nombre] || 0) + item.cantidad;
            });
        });

        res.json({
            resumen: {
                totalVentas,
                ingresosTotales: ingresosTotales.toFixed(2),
                promedioPorVenta: totalVentas > 0 ? (ingresosTotales / totalVentas).toFixed(2) : 0
            },
            topProductos: productosVendidos
        });

    } catch (error) {
        res.status(500).json({ error: "Error al generar el reporte" });
    }
});

// Iniciar Servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo con éxito en el puerto ${PORT}`);
});

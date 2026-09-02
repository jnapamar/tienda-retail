const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// CLAVE SECRETA PARA TOKENS JWT
const JWT_SECRET = process.env.JWT_SECRET || 'RIPLEY_SUPER_SECRET_KEY_2026';

// 1. MIDDLEWARES
app.use(cors());
// Límite de tamaño ampliado para recibir imágenes Base64 grandes desde el cliente
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 5000;
const FILE_DB_PATH = path.join(__dirname, 'backup_productos.json');
const FILE_PEDIDOS_PATH = path.join(__dirname, 'backup_pedidos.json');
const FILE_USUARIOS_PATH = path.join(__dirname, 'backup_usuarios.json');

// Asegurar archivos JSON de contingencia local
if (!fs.existsSync(FILE_DB_PATH)) fs.writeFileSync(FILE_DB_PATH, JSON.stringify([]));
if (!fs.existsSync(FILE_PEDIDOS_PATH)) fs.writeFileSync(FILE_PEDIDOS_PATH, JSON.stringify([]));
if (!fs.existsSync(FILE_USUARIOS_PATH)) fs.writeFileSync(FILE_USUARIOS_PATH, JSON.stringify([]));

// ----------------------------------------------------
// ESQUEMAS Y MODELOS DE BASE DE DATOS
// ----------------------------------------------------

// Esquema de Usuarios
const UsuarioSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    rol: { type: String, default: 'vendedor' } // vendedor, admin
});

const Usuario = mongoose.model('Usuario', UsuarioSchema);

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

// Esquema de Pedidos / Ventas para Reportes
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
// FUNCIÓN PARA CREAR USUARIO ADMIN AUTOMÁTICAMENTE
// ----------------------------------------------------
async function crearAdminPorDefecto() {
    try {
        const emailAdmin = 'admin@tienda.com';
        const passAdmin = 'admin123';
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(passAdmin, salt);

        if (mongoose.connection.readyState === 1) {
            // Caso 1: MongoDB Conectado
            const adminExistente = await Usuario.findOne({ email: emailAdmin });
            if (!adminExistente) {
                const nuevoAdmin = new Usuario({
                    nombre: 'Administrador Principal',
                    email: emailAdmin,
                    password: passwordEncriptada,
                    rol: 'admin'
                });
                await nuevoAdmin.save();
                console.log('--------------------------------------------------');
                console.log('✅ Usuario Administrador inicial creado en MongoDB:');
                console.log(`   Correo: ${emailAdmin}`);
                console.log(`   Clave:  ${passAdmin}`);
                console.log('--------------------------------------------------');
            } else {
                console.log('ℹ️ El usuario administrador ya se encuentra en MongoDB.');
            }
        } else {
            // Caso 2: Contingencia Archivos JSON
            let usuarios = JSON.parse(fs.readFileSync(FILE_USUARIOS_PATH, 'utf-8'));
            const existeLocal = usuarios.some(u => u.email === emailAdmin);
            if (!existeLocal) {
                const nuevoAdminLocal = {
                    _id: Date.now().toString(),
                    nombre: 'Administrador Principal',
                    email: emailAdmin,
                    password: passwordEncriptada,
                    rol: 'admin'
                };
                usuarios.push(nuevoAdminLocal);
                fs.writeFileSync(FILE_USUARIOS_PATH, JSON.stringify(usuarios, null, 2));
                console.log('--------------------------------------------------');
                console.log('✅ Usuario Administrador inicial creado en JSON Local:');
                console.log(`   Correo: ${emailAdmin}`);
                console.log(`   Clave:  ${passAdmin}`);
                console.log('--------------------------------------------------');
            }
        }
    } catch (error) {
        console.error('❌ Error al verificar/crear el usuario admin por defecto:', error.message);
    }
}

// Conexión a MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tienda_retail_db';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('✅ Conectado con éxito a MongoDB');
        await crearAdminPorDefecto();
    })
    .catch(async (err) => {
        console.log('⚠️ No se pudo conectar a MongoDB. Usando contingencia local por archivos.', err.message);
        await crearAdminPorDefecto();
    });

// ----------------------------------------------------
// MIDDLEWARE DE AUTENTICACIÓN Y AUTORIZACIÓN
// ----------------------------------------------------
function verificarAuth(req, res, next) {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        return res.status(401).json({ error: "Acceso denegado. No se proporcionó un token de autenticación." });
    }

    try {
        const token = authHeader.replace('Bearer ', '');
        const verificado = jwt.verify(token, JWT_SECRET);
        req.usuario = verificado;
        next(); // Permite la ejecución del endpoint
    } catch (error) {
        return res.status(403).json({ error: "Token inválido o expirado. Por favor, vuelve a iniciar sesión." });
    }
}

// Middleware opcional para asegurar que solo un Administrador realice ciertas acciones
function soloAdmin(req, res, next) {
    if (req.usuario && req.usuario.rol === 'admin') {
        next();
    } else {
        return res.status(403).json({ error: "Acceso denegado. Se requieren permisos de Administrador." });
    }
}

// ----------------------------------------------------
// 3. RUTAS DE NAVEGACIÓN Y VISTAS HTML
// ----------------------------------------------------

// Ruta para visualizar el Gestor de Pedidos / Reporte
app.get('/pedidos', (req, res) => {
    res.sendFile(path.join(__dirname, 'pedidos.html'));
});

// Ruta para visualizar el Panel de Administrador
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ----------------------------------------------------
// 4. RUTAS DE AUTENTICACIÓN Y GESTIÓN DE USUARIOS
// ----------------------------------------------------

// API POST: Registrar un Administrador inicial (Público / Registro Inicial)
app.post('/api/auth/registro', async (req, res) => {
    try {
        const { nombre, email, password } = req.body;

        if (!nombre || !email || !password) {
            return res.status(400).json({ error: "Todos los campos (nombre, email, password) son obligatorios." });
        }

        // Encriptar la contraseña
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(password, salt);

        if (mongoose.connection.readyState === 1) {
            const usuarioExistente = await Usuario.findOne({ email });
            if (usuarioExistente) {
                return res.status(400).json({ error: "El correo electrónico ya está registrado." });
            }

            const nuevoUsuario = new Usuario({
                nombre,
                email,
                password: passwordEncriptada,
                rol: 'admin'
            });

            await nuevoUsuario.save();
            return res.status(201).json({ mensaje: "Usuario administrador registrado con éxito en MongoDB." });
        } else {
            let usuarios = JSON.parse(fs.readFileSync(FILE_USUARIOS_PATH, 'utf-8'));
            if (usuarios.some(u => u.email === email)) {
                return res.status(400).json({ error: "El correo electrónico ya está registrado localmente." });
            }

            const nuevoUsuarioLocal = {
                _id: Date.now().toString(),
                nombre,
                email,
                password: passwordEncriptada,
                rol: 'admin'
            };

            usuarios.push(nuevoUsuarioLocal);
            fs.writeFileSync(FILE_USUARIOS_PATH, JSON.stringify(usuarios, null, 2));
            return res.status(201).json({ mensaje: "Usuario administrador registrado con éxito localmente." });
        }
    } catch (error) {
        console.error("Error en el registro:", error);
        res.status(500).json({ error: "Error al registrar el usuario." });
    }
});

// API POST: Crear Usuario desde el Panel Admin (PROTEGIDO)
app.post('/api/usuarios', verificarAuth, soloAdmin, async (req, res) => {
    try {
        const { nombre, email, password, rol } = req.body;

        if (!nombre || !email || !password) {
            return res.status(400).json({ error: "Nombre, email y contraseña son obligatorios." });
        }

        // Encriptar contraseña
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(password, salt);
        const rolAsignado = rol || 'vendedor';

        if (mongoose.connection.readyState === 1) {
            const usuarioExistente = await Usuario.findOne({ email });
            if (usuarioExistente) {
                return res.status(400).json({ error: "El correo electrónico ya está registrado." });
            }

            const nuevoUsuario = new Usuario({
                nombre,
                email,
                password: passwordEncriptada,
                rol: rolAsignado
            });

            await nuevoUsuario.save();
            return res.status(201).json({
                mensaje: "Usuario creado exitosamente.",
                usuario: { id: nuevoUsuario._id, nombre, email, rol: rolAsignado }
            });
        } else {
            let usuarios = JSON.parse(fs.readFileSync(FILE_USUARIOS_PATH, 'utf-8'));
            if (usuarios.some(u => u.email === email)) {
                return res.status(400).json({ error: "El correo electrónico ya está registrado localmente." });
            }

            const nuevoUsuarioLocal = {
                _id: Date.now().toString(),
                nombre,
                email,
                password: passwordEncriptada,
                rol: rolAsignado
            };

            usuarios.push(nuevoUsuarioLocal);
            fs.writeFileSync(FILE_USUARIOS_PATH, JSON.stringify(usuarios, null, 2));
            return res.status(201).json({
                mensaje: "Usuario creado exitosamente en contingencia local.",
                usuario: { id: nuevoUsuarioLocal._id, nombre, email, rol: rolAsignado }
            });
        }
    } catch (error) {
        console.error("Error al crear usuario:", error);
        res.status(500).json({ error: "Error interno al crear el usuario." });
    }
});

// API POST: Login / Iniciar Sesión (Obtener Token)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Proporcione email y contraseña." });
        }

        let usuarioEncontrado = null;

        if (mongoose.connection.readyState === 1) {
            usuarioEncontrado = await Usuario.findOne({ email });
        } else {
            const usuarios = JSON.parse(fs.readFileSync(FILE_USUARIOS_PATH, 'utf-8'));
            usuarioEncontrado = usuarios.find(u => u.email === email);
        }

        if (!usuarioEncontrado) {
            return res.status(400).json({ error: "Credenciales inválidas (Usuario no encontrado)." });
        }

        // Verificar la contraseña
        const esCorrecta = await bcrypt.compare(password, usuarioEncontrado.password);
        if (!esCorrecta) {
            return res.status(400).json({ error: "Credenciales inválidas (Contraseña incorrecta)." });
        }

        // Crear Token JWT válido por 8 horas (se incluye el ROL en el payload)
        const token = jwt.sign(
            { id: usuarioEncontrado._id, rol: usuarioEncontrado.rol },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            mensaje: "¡Inicio de sesión exitoso!",
            token,
            usuario: {
                nombre: usuarioEncontrado.nombre,
                email: usuarioEncontrado.email,
                rol: usuarioEncontrado.rol
            }
        });
    } catch (error) {
        console.error("Error en el login:", error);
        res.status(500).json({ error: "Error interno al iniciar sesión." });
    }
});

// ----------------------------------------------------
// 5. RUTAS DE API PRODUCTOS
// ----------------------------------------------------

// API POST: Crear Producto (PROTEGIDO)
app.post('/api/productos', verificarAuth, async (req, res) => {
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

// API GET: Listar Productos (PÚBLICO - Soporta filtro ?categoria=Tecnología)
app.get('/api/productos', async (req, res) => {
    try {
        const { categoria } = req.query;
        let filtro = {};

        if (categoria && categoria !== 'Todas') {
            filtro.categoria = new RegExp(`^${categoria}$`, 'i');
        }

        if (mongoose.connection.readyState === 1) {
            const productos = await Producto.find(filtro).sort({ _id: -1 });
            return res.json(productos);
        } else {
            let datos = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            if (categoria && categoria !== 'Todas') {
                datos = datos.filter(prod => prod.categoria && prod.categoria.toLowerCase() === categoria.toLowerCase());
            }
            return res.json(datos);
        }
    } catch (error) { 
        res.status(500).json({ error: "Error al obtener productos" }); 
    }
});

// API PUT: Modificar / Actualizar Producto (PROTEGIDO)
app.put('/api/productos/:id', verificarAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const datosActualizados = {
            codigo: req.body.codigo,
            vendedor: req.body.vendedor,
            nombre: req.body.nombre,
            precio: parseFloat(req.body.precio),
            categoria: req.body.categoria,
            descripcion: req.body.descripcion,
            imagen: req.body.imagen,
            stock: parseInt(req.body.stock) || 0
        };

        if (mongoose.connection.readyState === 1) {
            const productoEditado = await Producto.findByIdAndUpdate(
                id,
                datosActualizados,
                { new: true }
            );

            if (!productoEditado) {
                return res.status(404).json({ error: "Producto no encontrado en MongoDB" });
            }

            return res.json({ mensaje: "Producto actualizado en MongoDB con éxito", producto: productoEditado });
        } else {
            let datos = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            const index = datos.findIndex(p => p.id === Number(id) || p._id === id || p.id === id);

            if (index !== -1) {
                datos[index] = { ...datos[index], ...datosActualizados };
                fs.writeFileSync(FILE_DB_PATH, JSON.stringify(datos, null, 2));
                return res.json({ mensaje: "Producto actualizado en contingencia local con éxito", producto: datos[index] });
            } else {
                return res.status(404).json({ error: "Producto no encontrado en archivo local" });
            }
        }
    } catch (error) {
        console.error("Error al actualizar el producto:", error);
        res.status(500).json({ error: "Error interno al modificar el producto", detalle: error.message });
    }
});

// API DELETE: Eliminar Producto (PROTEGIDO)
app.delete('/api/productos/:id', verificarAuth, async (req, res) => {
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
// 6. RUTAS DE VENTAS Y COMPRAS (PÚBLICO)
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
            const nuevoPedido = new Pedido(datosPedido);
            await nuevoPedido.save();

            for (let item of carrito) {
                const cantidadARestar = parseInt(item.cantidad) || 1;
                await Producto.updateOne({ nombre: item.nombre }, { $inc: { stock: -cantidadARestar } });
            }

            return res.json({ 
                mensaje: "¡Pedido registrado con éxito!",
                pedidoId: nuevoPedido._id 
            });

        } else {
            let pedidos = JSON.parse(fs.readFileSync(FILE_PEDIDOS_PATH, 'utf-8'));
            const nuevoPedidoLocal = { _id: Date.now().toString(), ...datosPedido };
            pedidos.unshift(nuevoPedidoLocal);
            fs.writeFileSync(FILE_PEDIDOS_PATH, JSON.stringify(pedidos, null, 2));

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
// 7. RUTAS DE REPORTES Y GESTIÓN DE PEDIDOS (PROTEGIDO)
// ----------------------------------------------------

async function obtenerListaPedidos() {
    if (mongoose.connection.readyState === 1) {
        return await Pedido.find().sort({ fecha: -1 });
    } else {
        return JSON.parse(fs.readFileSync(FILE_PEDIDOS_PATH, 'utf-8'));
    }
}

app.get(['/api/ventas', '/api/pedidos'], verificarAuth, async (req, res) => {
    try {
        const ventas = await obtenerListaPedidos();
        return res.json(ventas);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener el historial de pedidos" });
    }
});

app.get('/api/ventas/reporte', verificarAuth, async (req, res) => {
    try {
        const ventas = await obtenerListaPedidos();

        const totalVentas = ventas.length;
        const ingresosTotales = ventas.reduce((acc, v) => acc + ((v.cliente && v.cliente.totalConEnvio) || 0), 0);
        
        const productosVendidos = {};
        ventas.forEach(v => {
            if (v.items && Array.isArray(v.items)) {
                v.items.forEach(item => {
                    productosVendidos[item.nombre] = (productosVendidos[item.nombre] || 0) + (item.cantidad || 1);
                });
            }
        });

        res.json({
            resumen: {
                totalVentas,
                ingresosTotales: ingresosTotales.toFixed(2),
                promedioPorVenta: totalVentas > 0 ? (ingresosTotales / totalVentas).toFixed(2) : '0.00'
            },
            topProductos: productosVendidos
        });

    } catch (error) {
        res.status(500).json({ error: "Error al generar el reporte de métricas" });
    }
});

// Iniciar Servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo con éxito en el puerto ${PORT}`);
});

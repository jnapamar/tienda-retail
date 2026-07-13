const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Usamos ÚNICAMENTE 'app' para evitar duplicados y conflictos
const app = express();

// 1. CONFIGURACIONES GENERALES (MIDDLEWARES)
app.use(cors());
app.use(express.json());

// 2. SERVIR ARCHIVOS ESTÁTICOS (Aquí se soluciona lo de tus imágenes)
// Esto mapea la ruta de internet '/uploads' a tu carpeta física 'uploads'
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Si tu HTML, CSS y JS principales están sueltos en la raíz, esto los servirá en internet:
app.use(express.static(__dirname));

// Configuración de Puertos para Render
const PORT = process.env.PORT || 5000;
const FILE_DB_PATH = path.join(__dirname, 'backup_productos.json');

// Asegurar directorios mínimos en el servidor
if (!fs.existsSync(FILE_DB_PATH)) fs.writeFileSync(FILE_DB_PATH, JSON.stringify([]));
if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));

// Configuración de Multer para Imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'uploads/'); },
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

// Conexión limpia a MongoDB (Compatible con Atlas en producción y Local en tu PC)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tienda_retail_db';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado con éxito a MongoDB'))
    .catch((err) => {
        console.log('⚠️ No se pudo conectar a MongoDB. Usando contingencia local por archivos.', err.message);
    });

// Esquema de Productos
const ProductoSchema = new mongoose.Schema({
    nombre: String,
    precio: Number,
    categoria: String,
    imagen: String,
    descripcion: String,
    stock: Number 
});
const Producto = mongoose.model('Producto', ProductoSchema);

// --- TUS RUTAS (Todas unificadas bajo 'app') ---

// API POST: Recibir producto con Stock
app.post('/api/productos', upload.single('imagen'), async (req, res) => {
    try {
        const rutaImagen = req.file ? `/uploads/${req.file.filename}` : '';
        
        const datosProducto = {
            nombre: req.body.nombre,
            precio: parseFloat(req.body.precio),
            categoria: req.body.categoria,
            descripcion: req.body.descripcion,
            imagen: rutaImagen,
            stock: parseInt(req.body.stock) || 0
        };

        if (mongoose.connection.readyState === 1) {
            const nuevo = new Producto(datosProducto);
            await nuevo.save();
            return res.status(201).json({ mensaje: "Guardado en MongoDB", producto: nuevo });
        } else {
            const datos = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            const nuevoItem = { id: Date.now(), ...datosProducto };
            datos.unshift(nuevoItem);
            fs.writeFileSync(FILE_DB_PATH, JSON.stringify(datos, null, 2));
            return res.status(201).json({ mensaje: "Guardado en contingencia Local", producto: nuevoItem });
        }
    } catch (error) {
        res.status(400).json({ error: "Error al guardar el producto" });
    }
});

// API GET: Listar productos
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

// API POST: Restar Stock dinámico al procesar la compra
app.post('/api/productos/comprar', async (req, res) => {
    try {
        const { carrito } = req.body; // Cada item del carrito ahora debería incluir { nombre, cantidad }

        if (!carrito || carrito.length === 0) {
            return res.status(400).json({ error: "El carrito está vacío" });
        }

        if (mongoose.connection.readyState === 1) {
            for (let item of carrito) {
                // Leemos item.cantidad. Si no viene, por defecto restamos 1.
                const cantidadARestar = parseInt(item.cantidad) || 1;
                
                // Usamos -$inc con la cantidad elegida para restar correctamente
                await Producto.updateOne({ nombre: item.nombre }, { $inc: { stock: -cantidadARestar } });
            }
        } else {
            let datos = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            for (let item of carrito) {
                const cantidadARestar = parseInt(item.cantidad) || 1;
                let p = datos.find(prod => prod.nombre === item.nombre);
                
                if (p && p.stock >= cantidadARestar) {
                    p.stock -= cantidadARestar;
                }
            }
            fs.writeFileSync(FILE_DB_PATH, JSON.stringify(datos, null, 2));
        }
        res.json({ mensaje: "Stock actualizado con éxito" });
    } catch (error) {
        res.status(500).json({ error: "Error al actualizar inventario" });
    }
});

// API DELETE: Eliminar un producto (por ID o por Nombre)
app.delete('/api/productos/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (mongoose.connection.readyState === 1) {
            // Si está conectado a MongoDB, borramos por el _id único
            await Producto.findByIdAndDelete(id);
            return res.json({ mensaje: "Producto eliminado de MongoDB con éxito" });
        } else {
            // Si está en modo contingencia (JSON), filtramos el archivo
            let datos = JSON.parse(fs.readFileSync(FILE_DB_PATH, 'utf-8'));
            
            // Buscamos si el ID coincide (convertido a número ya que Date.now() es numérico)
            const datosFiltrados = datos.filter(prod => prod.id !== Number(id) && prod._id !== id);
            
            fs.writeFileSync(FILE_DB_PATH, JSON.stringify(datosFiltrados, null, 2));
            return res.json({ mensaje: "Producto eliminado de contingencia local" });
        }
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar el producto", detalle: error.message });
    }
});

// Encendemos el servidor usando 'app'
// Escuchamos en el puerto de Render y aceptamos conexiones externas ('0.0.0.0')
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo con éxito en el puerto ${PORT}`);
});

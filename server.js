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

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

// 1. REGISTRAR UN ADMINISTRADOR (Lo usas una vez para crear tu cuenta)
router.post('/registro', async (req, res) => {
    try {
        const { nombre, email, password } = req.body;

        let usuarioExistente = await Usuario.findOne({ email });
        if (usuarioExistente) return res.status(400).json({ error: 'El correo ya está registrado.' });

        // Encriptar la contraseña antes de guardarla
        const salt = await bcrypt.genSalt(10);
        const passwordEncriptada = await bcrypt.hash(password, salt);

        const nuevoUsuario = new Usuario({
            nombre,
            email,
            password: passwordEncriptada,
            rol: 'admin'
        });

        await nuevoUsuario.save();
        res.status(201).json({ mensaje: '¡Administrador creado con éxito!' });
    } catch (error) {
        res.status(500).json({ error: 'Error al registrar el usuario.' });
    }
});

// 2. INICIAR SESIÓN (Obtener el carnet/token)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const usuario = await Usuario.findOne({ email });
        if (!usuario) return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });

        const esCorrecta = await bcrypt.compare(password, usuario.password);
        if (!esCorrecta) return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });

        // Entrega un carnet digital que dura 8 horas
        const token = jwt.sign(
            { id: usuario._id, rol: usuario.rol }, 
            process.env.JWT_SECRET || 'CLAVE_SECRETA_RIPLEY', 
            { expiresIn: '8h' }
        );

        res.json({ token, usuario: { nombre: usuario.nombre, email: usuario.email } });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor al intentar entrar.' });
    }
});

module.exports = router;

const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    // Busca el token en los encabezados del mensaje
    const token = req.header('Authorization');

    if (!token) {
        return res.status(401).json({ error: 'Acceso denegado. Debes iniciar sesión primero.' });
    }

    try {
        const tokenLimpio = token.replace('Bearer ', '');
        const verificado = jwt.verify(tokenLimpio, process.env.JWT_SECRET || 'CLAVE_SECRETA_RIPLEY');
        req.usuario = verificado;
        next(); // ¡Todo bien! Lo deja pasar a la siguiente acción.
    } catch (error) {
        res.status(400).json({ error: 'Sesión inválida o expirada.' });
    }
};

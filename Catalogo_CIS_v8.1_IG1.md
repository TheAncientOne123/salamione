# Catálogo de referencia — CIS Controls v8.1, Implementation Group 1 (IG1)

Base normativa del agente. Contiene las 56 salvaguardas IG1. Los controles 13, 16 y 18 NO tienen salvaguardas IG1 (sus salvaguardas inician en IG2), por lo que no se evalúan en este alcance.

Distribución: C1(2) · C2(3) · C3(6) · C4(7) · C5(4) · C6(5) · C7(4) · C8(3) · C9(2) · C10(3) · C11(4) · C12(1) · C14(8) · C15(1) · C17(3) = 56

| ID | Control CIS | Salvaguarda | Descripción breve |
|---|---|---|---|
| 1.1 | 1. Inventario y control de activos empresariales | Establecer y mantener un inventario detallado de activos empresariales | Inventario preciso y actualizado de todos los activos (usuario final, red, IoT, servidores, cloud) con dirección, propietario, departamento y si está aprobado. Revisión semestral o más frecuente. |
| 1.2 | 1. Inventario y control de activos empresariales | Gestionar activos no autorizados | Proceso para tratar activos no autorizados (retirar, bloquear acceso remoto o poner en cuarentena), al menos semanal. |
| 2.1 | 2. Inventario y control de activos de software | Establecer y mantener un inventario de software | Inventario detallado del software instalado (título, editor, versión, propósito, fecha). Revisión semestral. |
| 2.2 | 2. Inventario y control de activos de software | Asegurar que el software autorizado tenga soporte vigente | Solo software con soporte del fabricante en el inventario autorizado; el que no tiene soporte se documenta como excepción con controles compensatorios. Revisión mensual. |
| 2.3 | 2. Inventario y control de activos de software | Gestionar software no autorizado | Retirar el software no autorizado o documentar la excepción. Revisión mensual. |
| 3.1 | 3. Protección de datos | Establecer y mantener un proceso de gestión de datos | Proceso documentado que cubra sensibilidad, propietario, manejo, retención y eliminación de datos. Revisión anual. |
| 3.2 | 3. Protección de datos | Establecer y mantener un inventario de datos | Inventario de datos basado en el proceso de gestión; al menos los datos sensibles. Revisión anual. |
| 3.3 | 3. Protección de datos | Configurar listas de control de acceso a datos | Permisos de acceso basados en necesidad de conocer, aplicados a sistemas de archivos, bases de datos y aplicaciones. |
| 3.4 | 3. Protección de datos | Aplicar la retención de datos | Retener datos según el proceso de gestión, con plazos mínimos y máximos. |
| 3.5 | 3. Protección de datos | Eliminar datos de forma segura | Eliminación segura conforme al proceso, adecuada a la sensibilidad del dato. |
| 3.6 | 3. Protección de datos | Cifrar datos en dispositivos de usuario final | Cifrado de disco en dispositivos de usuario final con datos sensibles (p. ej. BitLocker, FileVault). |
| 4.1 | 4. Configuración segura de activos y software | Establecer y mantener un proceso de configuración segura | Proceso documentado de configuración segura (hardening) para activos y software, incluidos cloud. Revisión anual. |
| 4.2 | 4. Configuración segura de activos y software | Establecer y mantener un proceso de configuración segura para infraestructura de red | Estándares de configuración segura para dispositivos de red. Revisión anual. |
| 4.3 | 4. Configuración segura de activos y software | Configurar el bloqueo automático de sesión | Bloqueo automático por inactividad (≤15 min en SO de propósito general; ≤2 min en móviles). |
| 4.4 | 4. Configuración segura de activos y software | Implementar y gestionar un firewall en servidores | Firewall en servidores (o equivalente: VM firewall, grupos de seguridad, terceros). |
| 4.5 | 4. Configuración segura de activos y software | Implementar y gestionar un firewall en dispositivos de usuario final | Firewall basado en host o herramienta de filtrado de puertos con denegación por defecto. |
| 4.6 | 4. Configuración segura de activos y software | Gestionar de forma segura activos y software | Administración mediante código de infraestructura con control de versiones y protocolos seguros (SSH, HTTPS); evitar Telnet/HTTP. |
| 4.7 | 4. Configuración segura de activos y software | Gestionar cuentas predeterminadas | Deshabilitar o cambiar contraseñas de cuentas por defecto (root, administrador, cuentas preconfiguradas). |
| 5.1 | 5. Gestión de cuentas | Establecer y mantener un inventario de cuentas | Inventario de todas las cuentas (usuario y administrador) con nombre, usuario, fechas, departamento. Validación trimestral. |
| 5.2 | 5. Gestión de cuentas | Usar contraseñas únicas | Contraseñas únicas por activo; mínimo 8 caracteres con MFA o 14 sin MFA. |
| 5.3 | 5. Gestión de cuentas | Deshabilitar cuentas inactivas | Eliminar o deshabilitar cuentas inactivas tras 45 días. |
| 5.4 | 5. Gestión de cuentas | Restringir privilegios de administrador a cuentas dedicadas | Privilegios de administrador solo en cuentas dedicadas; las tareas generales se hacen con cuenta sin privilegios. |
| 6.1 | 6. Gestión del control de acceso | Establecer un proceso de otorgamiento de acceso | Proceso (preferentemente automatizado) para otorgar acceso al alta o cambio de rol. |
| 6.2 | 6. Gestión del control de acceso | Establecer un proceso de revocación de acceso | Proceso para revocar acceso de inmediato ante baja, cambio de rol o revocación de derechos; preferentemente deshabilitar en lugar de borrar para conservar auditoría. |
| 6.3 | 6. Gestión del control de acceso | Requerir MFA para aplicaciones expuestas externamente | MFA en todas las aplicaciones empresariales o de terceros expuestas externamente. |
| 6.4 | 6. Gestión del control de acceso | Requerir MFA para acceso remoto a la red | MFA para acceso remoto a la red. |
| 6.5 | 6. Gestión del control de acceso | Requerir MFA para acceso administrativo | MFA en todas las cuentas de acceso administrativo, en todos los activos, propios o de terceros. |
| 7.1 | 7. Gestión continua de vulnerabilidades | Establecer y mantener un proceso de gestión de vulnerabilidades | Proceso documentado de gestión de vulnerabilidades. Revisión anual. |
| 7.2 | 7. Gestión continua de vulnerabilidades | Establecer y mantener un proceso de remediación | Estrategia de remediación basada en riesgo, con revisiones mensuales o más frecuentes. |
| 7.3 | 7. Gestión continua de vulnerabilidades | Realizar gestión automatizada de parches del sistema operativo | Actualizaciones automáticas de SO, mensual o más frecuente. |
| 7.4 | 7. Gestión continua de vulnerabilidades | Realizar gestión automatizada de parches de aplicaciones | Actualizaciones automáticas de aplicaciones, mensual o más frecuente. |
| 8.1 | 8. Gestión de registros de auditoría | Establecer y mantener un proceso de gestión de registros de auditoría | Proceso que defina recolección, revisión y retención de logs. Revisión anual. |
| 8.2 | 8. Gestión de registros de auditoría | Recopilar registros de auditoría | Habilitar la recolección de logs en los activos según el proceso. |
| 8.3 | 8. Gestión de registros de auditoría | Asegurar almacenamiento adecuado de registros | Capacidad de almacenamiento suficiente para cumplir el proceso de gestión de logs. |
| 9.1 | 9. Protección de correo y navegador | Asegurar el uso exclusivo de navegadores y clientes de correo con soporte | Solo navegadores y clientes de correo con soporte y en su versión más reciente. |
| 9.2 | 9. Protección de correo y navegador | Usar servicios de filtrado DNS | Filtrado DNS en todos los activos para bloquear dominios maliciosos. |
| 10.1 | 10. Defensas contra malware | Desplegar y mantener software antimalware | Antimalware en todos los activos empresariales. |
| 10.2 | 10. Defensas contra malware | Configurar actualizaciones automáticas de firmas | Actualización automática de firmas antimalware. |
| 10.3 | 10. Defensas contra malware | Deshabilitar autoejecución en medios removibles | Deshabilitar autorun/autoplay en medios removibles. |
| 11.1 | 11. Recuperación de datos | Establecer y mantener un proceso de recuperación de datos | Proceso documentado: alcance, priorización y seguridad de los respaldos. Revisión anual. |
| 11.2 | 11. Recuperación de datos | Realizar respaldos automatizados | Respaldos automatizados semanales o más frecuentes según sensibilidad. |
| 11.3 | 11. Recuperación de datos | Proteger los datos de recuperación | Proteger los respaldos con controles equivalentes a los datos originales (p. ej. cifrado, separación). |
| 11.4 | 11. Recuperación de datos | Establecer y mantener una instancia aislada de datos de recuperación | Copia aislada (offline, cloud o fuera de sitio) mediante control de versiones o destino desconectado. |
| 12.1 | 12. Gestión de infraestructura de red | Asegurar que la infraestructura de red esté actualizada | Infraestructura de red con versión estable y soportada más reciente; revisión mensual. |
| 14.1 | 14. Concienciación y capacitación en seguridad | Establecer y mantener un programa de concienciación | Programa de concienciación al ingreso y al menos anual. |
| 14.2 | 14. Concienciación y capacitación en seguridad | Capacitar para reconocer ataques de ingeniería social | Phishing, pretexting, tailgating, etc. |
| 14.3 | 14. Concienciación y capacitación en seguridad | Capacitar en buenas prácticas de autenticación | MFA, composición de contraseñas, gestión de credenciales. |
| 14.4 | 14. Concienciación y capacitación en seguridad | Capacitar en buenas prácticas de manejo de datos | Identificar, almacenar, transferir, archivar y destruir datos sensibles. |
| 14.5 | 14. Concienciación y capacitación en seguridad | Capacitar sobre causas de exposición no intencional de datos | Envío erróneo, pérdida de dispositivos, publicación accidental. |
| 14.6 | 14. Concienciación y capacitación en seguridad | Capacitar para reconocer y reportar incidentes | Identificar y reportar posibles incidentes. |
| 14.7 | 14. Concienciación y capacitación en seguridad | Capacitar para identificar y reportar actualizaciones faltantes | Verificar y reportar parches o actualizaciones pendientes. |
| 14.8 | 14. Concienciación y capacitación en seguridad | Capacitar sobre riesgos de redes inseguras | Riesgos de conectarse y transmitir datos por redes inseguras; configuración segura de redes domésticas para personal remoto. |
| 15.1 | 15. Gestión de proveedores de servicios | Establecer y mantener un inventario de proveedores de servicios | Inventario con clasificación y contacto de cada proveedor. Revisión anual. |
| 17.1 | 17. Gestión de respuesta a incidentes | Designar personal para gestionar incidentes | Responsable principal y al menos un suplente para la gestión de incidentes. |
| 17.2 | 17. Gestión de respuesta a incidentes | Establecer y mantener información de contacto para reportar incidentes | Directorio de contactos (internos, terceros, autoridades, aseguradoras) para incidentes. Revisión anual. |
| 17.3 | 17. Gestión de respuesta a incidentes | Establecer y mantener un proceso para reportar incidentes | Proceso documentado: a quién reportar, plazos, mecanismo e información mínima. Revisión anual. |

Nota: verificar redacción final contra la publicación oficial de CIS Controls v8.1 (cisecurity.org).

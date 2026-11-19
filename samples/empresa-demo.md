# Informe interno de situación — Distribuidora Andina S.A.

Empresa: Distribuidora Andina S.A.
Sector: distribución mayorista de alimentos. 140 empleados, 3 depósitos.
Fecha del informe: octubre 2026. Preparado por: Gerencia de Administración.

## 1. Situación financiera
El ejercicio 2025 cerró con pérdidas por 38 millones. El flujo de caja fue negativo en 7 de los últimos 12 meses.
Existe atraso en los pagos a proveedores de 45 días promedio y se renegoció deuda bancaria a tasa variable.
El 52% de las ventas se concentra en un solo cliente (cadena de supermercados), lo que genera concentración de clientes.
Los pagos a proveedores los carga y aprueba la misma persona (tesorero); no hay doble firma.
Los estados contables son revisados anualmente por un auditor externo (estudio contable independiente).

## 2. Tecnología y seguridad de la información
El ERP corre sobre un servidor con Windows Server 2008, sin soporte del fabricante desde hace años.
Gran parte de la facturación y el stock se controla manualmente en planillas de Excel.
En marzo de 2026 sufrimos un ataque de ransomware que cifró el servidor de archivos; estuvimos 6 días sin facturar.
No hay copias de seguridad automáticas: el backup se hace a mano en un disco externo cuando alguien se acuerda y nunca se probó restaurarlo.
Los usuarios del ERP son compartidos por sector y las contraseñas no se cambian. No existe doble factor de autenticación.
No contamos con una política de seguridad de la información aprobada.
El antivirus está instalado solo en algunas PCs y no se aplican parches de seguridad de forma regular.
Existe un inventario de equipos en una planilla de Excel, actualizado por última vez en 2024.
Los servidores tienen el firewall de Windows habilitado.
El acceso remoto de los vendedores se hace por VPN, sin doble factor de autenticación.
Los usuarios de empleados que se fueron no se dan de baja en el ERP.
Todos los empleados usan sus PCs con permisos de administrador local.
El correo corporativo es Google Workspace y los navegadores se actualizan automáticamente.
Ante el ransomware no había un responsable designado ni un procedimiento para reportar incidentes; se improvisó.

## 3. Operaciones y continuidad
No existe un plan de continuidad del negocio ni un procedimiento de recuperación ante desastres.
El 80% de la mercadería refrigerada proviene de un único proveedor de logística en frío.
El jefe de sistemas es el único que sabe administrar el ERP y está evaluando una renuncia.
La rotación del personal de depósito fue del 35% anual.

## 4. Cumplimiento legal
En 2026 recibimos dos multas de bromatología por fallas en la cadena de frío y una intimación de la AFIP por diferencias en declaraciones juradas.
Hay tres juicios laborales en curso.
La base de clientes contiene datos personales (DNI, domicilios, teléfonos) y no está registrada ante la autoridad de protección de datos personales; no se pide consentimiento.

## 5. Personas
Se realiza una inducción de seguridad e higiene para todo el personal nuevo de depósito.
No hay capacitación en seguridad informática ni concientización sobre phishing.

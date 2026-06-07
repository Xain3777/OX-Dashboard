import pyodbc
conn_str = r'DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=C:\Users\Zein\Downloads\20260606 (2).mdb;'
conn = pyodbc.connect(conn_str)
cursor = conn.cursor()
cursor.execute('SELECT COUNT(*) FROM Userinfo')
total = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM Userinfo WHERE Name IS NOT NULL AND Name <> ''")
with_names = cursor.fetchone()[0]
cursor.execute('SELECT COUNT(*) FROM Userinfo WHERE Deptid = 3')
normal = cursor.fetchone()[0]
cursor.execute('SELECT COUNT(*) FROM Userinfo WHERE Deptid = 4')
disabled = cursor.fetchone()[0]
print('Total members:', total)
print('With names:', with_names)
print('Without names:', total - with_names)
print('Normal dept (allowed):', normal)
print('Disabled dept (blocked):', disabled)
conn.close()

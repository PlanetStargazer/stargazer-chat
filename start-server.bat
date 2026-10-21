@echo off
echo Starting Stargazer Chat on http://localhost:8080 ...
D:\php\php.exe -d extension_dir="D:\php\ext" -d extension=mbstring -d extension=pdo_sqlite -d extension=sqlite3 -S localhost:8080
pause

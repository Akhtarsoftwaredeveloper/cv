AKHTAR MUHAMMAD PORTFOLIO WEBSITE  (complete, with Admin Panel)
================================================================

Start here: open HOW-TO-UPLOAD.txt (plain-language guide).

Test login for the Admin Panel (change it on first login!)
    Username: admin
    Password: Admin123

Pages
    index.html       Home
    about.html       About (story, teaching, skills, awards, journey, projects)
    services.html    Services with prices
    portfolio.html   Portfolio with filter tabs and lightbox
    contact.html     Contact details, social links and message form
    admin/           Admin Panel (open yourdomain.com/admin)

How it works
    - Every page reads data/site.json when it loads. The Admin Panel
      saves that file through api.php, so changes are live at once.
    - Text on each page is editable because elements carry data-cms
      attributes. The Admin Panel reads the pages to build its forms.
    - Lists (services, projects, awards, testimonials, tools), images,
      contact details, social links and the colour theme come from
      data/site.json too.
    - assets/js/site-defaults.js is a built-in copy of the starting
      content, used only if data/site.json cannot be loaded.

Folders
    assets/   css, js and images used by the pages
    data/     site.json: all your saved content   (must be writable)
    uploads/  pictures you upload                 (must be writable)
    private/  admin login + messages, never public (must be writable)
    admin/    the Admin Panel screens

Themes (assets/css/theme.css)
    Charcoal Orange, Midnight Blue, Slate Purple, Emerald Dark

Requirements
    Any web hosting with PHP 7 or newer. No database needed.

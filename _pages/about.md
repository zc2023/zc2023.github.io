---
permalink: /
title: "About me"
excerpt: "About me"
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---




I'm currently studying at Huazhong University of Science and Technology, under the supervision of Prof. [Xiang Bai](https://scholar.google.com/citations?user=UeltiQ4AAAAJ&hl=en) ([IEEE Fellow](https://mp.weixin.qq.com/s/U9_vbKV15dzJyxy5S72Q8A)). My current research interests are mainly in Multi-modal Large Language Models (MLLMs), embodied AI, and 3D vision. I work closely with [Dingkang Liang](https://dk-liang.github.io/) at HUST VLRLab.

<div class="windsong-regular gradient-text">
  Less is more, slow is fast.
</div>

🔍 Research Interests
------
<ul>
{% for interest in site.data.home.research_interests -%}
  <li>{{ interest }}</li>
{% endfor -%}
</ul>


🔥 News
------
<ul>
{% for item in site.data.home.news -%}
  <li>{{ item | markdownify | remove: '<p>' | remove: '</p>' }}</li>
{% endfor -%}
</ul>

📝 Publications
------
<span class="home-note">* Equal Contribution, † Corresponding Author</span>

{% include home-publications.html items=site.data.home.publications %}

See full publication list on [Google Scholar ->](https://scholar.google.com/citations?user=YVDMI8EAAAAJ&hl=en)



💼 Internship
------
{% include home-list-section.html items=site.data.home.internship spacing="compact" %}


📘 Research Experience
------
{% include home-list-section.html items=site.data.home.research_experience %}

🏅 Honors and Awards
------
{% include home-list-section.html items=site.data.home.honors spacing="compact" %}


Patents
------
{% include home-list-section.html items=site.data.home.patents spacing="tight" %}


📖 Educations
------
{% include home-list-section.html items=site.data.home.education spacing="compact" %}


🎓 Academic Service
------
{{ site.data.home.academic_service }}






{% include floating-nav.html %}


---

<script type="text/plain" id="clustrmaps" data-deferred-src="//cdn.clustrmaps.com/map_v2.js?cl=ffffff&w=300&t=tt&d=4yP6BEk3dPm3WM4dSyHf6UzOTTNUv23thzo95DQTAsw&co=a8e6ff&cmo=3acc3a&cmn=ff5353&ct=000000"></script>

---

<div class="center_box">
    <img class="counter" alt="Site visitor counter" loading="lazy" decoding="async" fetchpriority="low" data-deferred-src="https://count.getloli.com/@zc2023.github.io?name=zc2023.github.io&theme=moebooru&padding=7&offset=0&align=center&scale=0.85&pixelated=1&darkmode=auto">
</div>

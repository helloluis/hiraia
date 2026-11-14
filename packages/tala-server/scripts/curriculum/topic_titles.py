"""Reviewable deterministic UI labels. These never change source competency text.
Short complete headings and colon suffixes are official. Longer headings use
explicit noun-phrase candidates, preferring the first phrase present in the LC.
The last candidate is the domain fallback; all such selections are derived.
"""
DERIVED = {
 'Systems in Plants and Animals': ['Plant and Animal Systems'],
 'Science in our Daily Life': ['Everyday Science'],
 'Guided Science Activities Using Process Skills': ['Science Process Skills'],
 'Guided Science Activities Using Process Skills and Living and Non-Living Things': ['Living and Non-Living Things'],
 'Basic Needs of Living Things': ['Basic Needs'],
 'Plants and Animals and their Habitats': ['Habitats'],
 'Animals and the Food they Eat': ['Animal Diets'],
 'Forces and Movement and Observing, Measuring, and Predicting': ['Forces', 'Movement'],
 'Magnets and Observing, Measuring, and Predicting': ['Magnets'],
 'Sound, Light, and Heat Energy': ['Sound', 'Light', 'Heat Energy'],
 'Matter and the Three States': ['States of Matter'],
 'Life Cycles of Living Things': ['Life Cycles'],
 'Conductors, Insulators, and Simple Circuits': ['Conductors', 'Insulators', 'Simple Circuits'],
 'The Water Cycle and Using Models': ['Water Cycle'],
 'Diagrams and Flowcharts, Processes of Changes of State': ['Heat Energy', 'Changes of State'],
 'Processes of Interactions between Living Things': ['Living Things Interactions'],
 'Biotic and Abiotic Factors in an Ecosystem': ['Biotic and Abiotic Factors'],
 'Properties of Water and Sound Waves': ['Amplitude', 'Frequency', 'Wavelength', 'Water and Sound Waves'],
 'Use of Models and the Particle Model and Changes of State': ['Changes of State', 'Particle Model'],
 'Planning, Following, and Recording Scientific Investigations': ['Scientific Investigations'],
 'Science Equipment: The Compound Microscope': ['Compound Microscope'],
 'Motion: Displacement and Velocity, Graphing Motion, and Identifying and Controlling Variables': ['Displacement', 'Velocity', 'Motion'],
 'The Sun’s Influence on Earth and System Models': ['Solar Energy', 'Sun and Earth'],
 'Use of Timelines and Charts, Photosynthesis, Respiration and Cycles in Nature': ['Photosynthesis', 'Respiration', 'Cycles in Nature'],
 'Use of Timelines and Charts on the Atomic Model': ['Atomic Model'],
 'Acceleration and Distance-time and Velocity-time Graphs': ['Acceleration', 'Motion Graphs'],
 'Kinetic Energy and Potential Energy': ['Kinetic Energy', 'Potential Energy'],
 'Newton’s Laws, Force, and Energy': ['Newton’s Laws', 'Force', 'Energy'],
 'Electric Current, Electrical Circuits, Interpreting Patterns in Data, and Electromagnetic Waves': ['Electromagnetic Waves', 'Electric Current', 'Electrical Circuits'],
 'Scale, Proportion, and Quantity, Structure of the Earth, and Geologic Time': ['Geologic Time', 'Structure of the Earth'],
 'Origin of the Solar System': ['Solar System Origin'],
 'Types of Ecosystems in the Philippines': ['Philippine Ecosystems'],
 'Chemical Bonding: Ionic Compounds and Covalent Compounds': ['Ionic Compounds', 'Covalent Compounds'],
 'Valid and Reliable Investigations and Chemical Bonding': ['Chemical Bonding'],
 'Types of Chemical Reactions and Chemical Reactions in the Environment': ['Chemical Reactions'],
 'Ecosystem’s Carrying Capacity and Population Growth': ['Carrying Capacity', 'Population Growth'],
 'Large-scale Generation and Distribution of Electricity': ['Electricity Generation and Distribution'],
}

def short_title(record):
    domain = record['domain'] or ''
    if 1 <= len(domain.split()) <= 4:
        return domain, 'official'
    if ':' in domain:
        suffix = domain.split(':', 1)[1].strip()
        if 1 <= len(suffix.split()) <= 4:
            return suffix, 'official'
    candidates = DERIVED[domain]  # Fail closed: unseen long headings need review.
    title = next((p for p in candidates if p.casefold() in record['text'].casefold()), candidates[-1])
    assert 1 <= len(title.split()) <= 4
    return title, 'derived'
